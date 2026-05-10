import { NextRequest, NextResponse } from 'next/server';
import { analyzeCascadeInteractions } from '../../../../../src/mcp-server/tools/cascade-interactions';
import { checkOrganFunctionDosing } from '../../../../../src/mcp-server/tools/organ-function-dosing';
import { screenDeprescribing } from '../../../../../src/mcp-server/tools/deprescribing-screen';
import { analyzePDInteractions } from '../../../../../src/mcp-server/tools/pd-interactions';
import { checkPharmacogenomics } from '../../../../../src/mcp-server/tools/pharmacogenomics';
import { checkLabMonitoring } from '../../../../../src/mcp-server/tools/lab-monitoring';
import { logToolCall } from '../../../../../src/audit/db';
import { loadMrsJohnsonData } from '../../../../../data/synthea/mrs-johnson/index';
import { loadMrPatelData } from '../../../../../data/synthea/mr-patel/index';
import { createHash } from 'node:crypto';

function hashInput(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 16);
}

async function runClinicalTool<T>(
  requestId: string,
  toolName: string,
  run: () => Promise<T[]>
): Promise<{ findings: T[]; status: { ok: boolean; count: number; error?: string } }> {
  try {
    const findings = await run();
    return { findings, status: { ok: true, count: findings.length } };
  } catch (err) {
    const error = (err as Error).message;
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      svc: 'web-api',
      level: 'error',
      reqId: requestId,
      toolName,
      msg: 'clinical tool failed',
      error,
    }));
    return { findings: [], status: { ok: false, count: 0, error } };
  }
}

/**
 * Dispatch synthetic patient bundle by patientId.
 * Production builds would resolve via FHIR server; for the hackathon demo we
 * route between hand-curated cases. Unknown IDs fall back to Mrs. Johnson so
 * existing links keep working.
 */
function loadPatientByID(patientId: string) {
  const id = patientId.toLowerCase();
  if (id.includes('patel')) return loadMrPatelData();
  return loadMrsJohnsonData();
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ patientId: string }> }) {
  const { patientId } = await params;
  const start = Date.now();
  // Stable request id for cross-service tracing — propagated to ML scorer
  // via X-Request-Id and echoed in the response so client/log correlation is
  // possible without sticky sessions.
  const requestId = (_req.headers.get('x-request-id') ?? createHash('sha256').update(`${patientId}-${start}`).digest('hex').slice(0, 8));

  // For demo: dispatch synthetic patients by ID.
  // In production: fetch from FHIR server using patientId.
  const patientData = loadPatientByID(patientId);

  // Extract medication names from FHIR resources
  const medications = patientData.medications.map(m => m.medicationCodeableConcept?.text ?? 'Unknown');

  // Extract lab values from observations
  const recentLabs = patientData.observations
    .filter(o => o.valueQuantity)
    .map(o => ({
      loincCode: o.code.coding?.[0]?.code ?? '',
      value: o.valueQuantity!.value,
      date: o.effectiveDateTime ?? '',
      labName: o.code.text ?? o.code.coding?.[0]?.display ?? '',
    }));

  // Get patient age from birthDate
  const birthDate = patientData.patient.birthDate;
  const patientAge = birthDate
    ? Math.floor((Date.now() - new Date(birthDate).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
    : 78;

  // Get patient name
  const nameEntry = patientData.patient.name?.[0];
  const patientName = nameEntry
    ? `${nameEntry.prefix?.[0] ?? ''} ${nameEntry.given?.[0] ?? ''} ${nameEntry.family ?? ''}`.trim()
    : patientId;

  // Build patientContext so tools can apply organ-function severity escalation
  const egfr = recentLabs.find(o => o.loincCode === '33914-3')?.value;
  const patientContext = {
    patient: patientData.patient,
    medications: patientData.medications,
    observations: patientData.observations,
    conditions: patientData.conditions,
    age: patientAge,
    egfr,
  };

  // Run all six tools in parallel. Pharmacogenomics returns no findings unless
  // genotype data is supplied by the calling workflow.
  const genotypes: Record<string, string> = {};
  const [
    cascadeResult,
    dosingResult,
    deprescribingResult,
    pdResult,
    pharmacogenomicsResult,
    labMonitoringResult,
  ] = await Promise.all([
    runClinicalTool(requestId, 'analyze_cascade_interactions', () =>
      analyzeCascadeInteractions({ medications, patientContext })
    ),
    runClinicalTool(requestId, 'check_organ_function_dosing', () =>
      checkOrganFunctionDosing({ medications, patientContext })
    ),
    runClinicalTool(requestId, 'screen_deprescribing', () =>
      screenDeprescribing({ medications, patientAge, patientContext })
    ),
    runClinicalTool(requestId, 'analyze_pharmacodynamic_interactions', () =>
      analyzePDInteractions({ medications, patientContext })
    ),
    runClinicalTool(requestId, 'check_pharmacogenomics', () =>
      checkPharmacogenomics({ medications, genotypes })
    ),
    runClinicalTool(requestId, 'check_lab_monitoring', () =>
      checkLabMonitoring({ medications, recentLabs })
    ),
  ]);
  const cascade = cascadeResult.findings;
  const dosing = dosingResult.findings;
  const deprescribing = deprescribingResult.findings;
  const pd = pdResult.findings;
  const pharmacogenomics = pharmacogenomicsResult.findings;
  const labMonitoring = labMonitoringResult.findings;

  const reviewId = `review_${patientId}_${Date.now()}`;
  const outputs = { cascade, dosing, deprescribing, pd, pharmacogenomics, labMonitoring };
  const toolStatus = {
    cascade: cascadeResult.status,
    dosing: dosingResult.status,
    deprescribing: deprescribingResult.status,
    pd: pdResult.status,
    pharmacogenomics: pharmacogenomicsResult.status,
    labMonitoring: labMonitoringResult.status,
  };

  // Log to audit trail
  try {
    logToolCall({
      patientId,
      toolName: 'full_review',
      inputsHash: hashInput({ medications, patientId }),
      outputsJson: JSON.stringify(outputs),
      latencyMs: Date.now() - start,
    });
  } catch {
    // Audit logging failure should not block the review
  }

  // Fetch composite risk index from the heuristic service (if available).
  // This is a transparent additive composite, NOT an ML model — see ml-service/scorer.py.
  let riskScore = null;
  try {
    const conditionLabels = (patientData.conditions ?? [])
      .map((c: { code?: { text?: string; coding?: { display?: string }[] } }) =>
        c.code?.text ?? c.code?.coding?.[0]?.display ?? ''
      )
      .filter((s: string) => s.length > 0);

    // --- Derive new clinically defensible factor inputs --------------------
    // Prodrug activation failure: cascade findings whose text reflects loss of
    // active metabolite. Cascade tool emits "REDUCED active metabolite" or
    // "prodrug bioactivation" wording when an inhibitor blocks a prodrug
    // substrate (e.g. fluvoxamine + clopidogrel via CYP2C19).
    const prodrugFailures = cascade.filter(f => {
      const haystack = `${f.finding ?? ''} ${f.clinicalConsequence ?? ''}`.toLowerCase();
      return (
        haystack.includes('reduced active metabolite') ||
        haystack.includes('prodrug')
      );
    }).length;

    // Residual inhibitor window: any MedicationRequest with Paxlovid /
    // nirmatrelvir / ritonavir whose status is "completed" and authoredOn is
    // within the last ~10 days. Mechanism-based CYP3A4 inhibition persists
    // ~3-4 days after a typical 5-day Paxlovid course (FDA Paxlovid label).
    const now = Date.now();
    const residualInhibitorWindow = (patientData.medications ?? []).some(m => {
      const text = (m.medicationCodeableConcept?.text ?? '').toLowerCase();
      const isStrongCypMechanismInhibitor =
        text.includes('paxlovid') ||
        text.includes('ritonavir') ||
        text.includes('nirmatrelvir');
      if (!isStrongCypMechanismInhibitor) return false;
      if (m.status !== 'completed') return false;
      const authoredOn = m.authoredOn ? new Date(m.authoredOn).getTime() : NaN;
      if (Number.isNaN(authoredOn)) return false;
      // Treat authoredOn as proxy for course start; courses are ~5 days, and
      // residual inhibition extends another ~3-4 days. So flag if authored
      // within the last ~10 days.
      const TEN_DAYS_MS = 10 * 24 * 60 * 60 * 1000;
      return now - authoredOn <= TEN_DAYS_MS;
    });

    // DAPT at risk: stent / DES / PCI in conditions AND clopidogrel /
    // ticagrelor / prasugrel in meds AND at least one prodrug failure flagged
    // by the cascade tool (i.e. antiplatelet bioactivation compromised).
    const conditionsBlob = conditionLabels.join(' ').toLowerCase();
    const hasStentContext =
      conditionsBlob.includes('stent') ||
      conditionsBlob.includes('des') ||
      conditionsBlob.includes('pci') ||
      conditionsBlob.includes('coronary');
    const medsBlob = medications.join(' ').toLowerCase();
    const onP2y12Prodrug =
      medsBlob.includes('clopidogrel') ||
      medsBlob.includes('ticagrelor') ||
      medsBlob.includes('prasugrel');
    const daptAtRisk = hasStentContext && onP2y12Prodrug && prodrugFailures > 0;

    const mlResponse = await fetch('http://localhost:8001/risk-score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId },
      body: JSON.stringify({
        age: patientAge,
        egfr: recentLabs.find(o => o.loincCode === '33914-3')?.value ?? 90,
        egfr_loinc: '33914-3',
        medications,
        cyp_findings: cascade.map(f => ({ severity: f.severity, finding: f.finding })),
        pd_risk_score: pd.reduce((s, f) => s + (f.riskScore ?? 0), 0),
        beers_count: deprescribing.filter(f => f.beersFlag).length,
        lab_gaps: labMonitoring.filter(f => f.status !== 'CURRENT').length,
        conditions: conditionLabels,
        prodrug_failures: prodrugFailures,
        residual_inhibitor_window: residualInhibitorWindow,
        dapt_at_risk: daptAtRisk,
      }),
    });
    if (mlResponse.ok) riskScore = await mlResponse.json();
  } catch (err) {
    // Risk service not running — log and continue without score so the page
    // still renders. The trace id makes the failure easy to correlate.
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      svc: 'web-api',
      level: 'warn',
      reqId: requestId,
      msg: 'ML risk-score fetch failed; continuing without score',
      error: (err as Error).message,
    }));
  }

  console.error(JSON.stringify({
    ts: new Date().toISOString(),
    svc: 'web-api',
    reqId: requestId,
    method: 'GET',
    path: `/api/review/${patientId}`,
    status: 200,
    durMs: Date.now() - start,
    findingCounts: {
      cascade: cascade.length,
      dosing: dosing.length,
      deprescribing: deprescribing.length,
      pd: pd.length,
      pharmacogenomics: pharmacogenomics.length,
      lab: labMonitoring.length,
    },
  }));

  return NextResponse.json({
    reviewId,
    patientId,
    patientName,
    requestId,
    medications,
    riskScore,
    findings: outputs,
    toolStatus,
    timestamp: new Date().toISOString(),
  });
}
