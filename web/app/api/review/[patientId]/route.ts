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
import { FHIRClient } from '../../../../../src/fhir/client';
import { loadPatientBundle } from '../../../../../src/fhir/queries';
import { loadPatientGenotypes } from '../../../../../src/fhir/pgx-queries';
import { saveReview } from '../../../../../src/persistence/reviews';
import { createHash } from 'node:crypto';
import type { FHIRPatient, FHIRMedicationRequest, FHIRObservation, FHIRCondition } from '../../../../../src/types/fhir';

interface PatientBundleData {
  patient: FHIRPatient;
  medications: FHIRMedicationRequest[];
  observations: FHIRObservation[];
  conditions: FHIRCondition[];
}

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
 * Dispatch by patientId with explicit fallback rules:
 *  1. If SHARP/FHIR headers are present, fetch from the live FHIR server.
 *  2. Otherwise, if patientId matches a known synthea fixture, return it.
 *  3. Otherwise, return null so the caller can 404.
 *
 * The previous implementation silently fell back to Mrs. Johnson for any
 * unknown id — meaning a typo in the URL produced a real-looking review for
 * the wrong patient. That's a clinical-safety hazard. We now refuse to
 * fabricate.
 */
function loadFixturePatient(patientId: string): PatientBundleData | null {
  const id = patientId.toLowerCase();
  if (id.includes('patel')) return loadMrPatelData();
  if (id.includes('johnson')) return loadMrsJohnsonData();
  return null;
}

interface SHARPHeaders {
  fhirServerUrl: string;
  accessToken: string;
  patientId: string;
}

function extractSHARPHeaders(req: NextRequest, fallbackPatientId: string): SHARPHeaders | null {
  const fhirServerUrl = req.headers.get('x-fhir-server-url');
  const accessToken = req.headers.get('x-fhir-access-token');
  const patientId = req.headers.get('x-patient-id') ?? fallbackPatientId;
  if (!fhirServerUrl || !accessToken || !patientId) return null;
  return { fhirServerUrl, accessToken, patientId };
}

async function loadFromFHIR(headers: SHARPHeaders): Promise<PatientBundleData> {
  const client = new FHIRClient();
  client.connect(headers.fhirServerUrl, headers.accessToken);
  const bundle = await loadPatientBundle(client, headers.patientId);
  return {
    patient: bundle.patient,
    medications: bundle.medications,
    observations: bundle.observations,
    conditions: bundle.conditions,
  };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ patientId: string }> }) {
  const { patientId } = await params;
  const start = Date.now();
  // Stable request id for cross-service tracing — propagated to ML scorer
  // via X-Request-Id and echoed in the response so client/log correlation is
  // possible without sticky sessions.
  const requestId = (_req.headers.get('x-request-id') ?? createHash('sha256').update(`${patientId}-${start}`).digest('hex').slice(0, 8));

  // Resolve patient data with explicit precedence:
  //   1. SHARP-on-FHIR headers (live launch from an EHR)
  //   2. Synthetic fixture for known demo patients (mr-patel*, mrs-johnson*)
  //   3. 404 — never silently substitute another patient.
  const sharpHeaders = extractSHARPHeaders(_req, patientId);
  let patientData: PatientBundleData | null = null;
  let dataSource: 'fhir' | 'fixture' = 'fixture';
  if (sharpHeaders) {
    try {
      patientData = await loadFromFHIR(sharpHeaders);
      dataSource = 'fhir';
    } catch (err) {
      console.error(JSON.stringify({
        ts: new Date().toISOString(),
        svc: 'web-api',
        level: 'error',
        reqId: requestId,
        msg: 'FHIR hydration failed for SHARP-launched review',
        patientId,
        error: (err as Error).message,
      }));
      return NextResponse.json(
        {
          error: `Failed to load patient data from FHIR: ${(err as Error).message}`,
          code: 'FHIR_FETCH_FAILED',
          requestId,
        },
        { status: 502, headers: { 'X-Request-Id': requestId } }
      );
    }
  } else {
    patientData = loadFixturePatient(patientId);
    if (!patientData) {
      console.error(JSON.stringify({
        ts: new Date().toISOString(),
        svc: 'web-api',
        level: 'warn',
        reqId: requestId,
        msg: 'unknown patientId without SHARP headers',
        patientId,
      }));
      return NextResponse.json(
        {
          error: `Patient '${patientId}' not found. Provide SHARP-on-FHIR headers (X-FHIR-Server-URL, X-FHIR-Access-Token, X-Patient-ID) for a live launch, or use a known demo patient id (mr-patel-001, mrs-johnson).`,
          code: 'PATIENT_NOT_FOUND',
          requestId,
        },
        { status: 404, headers: { 'X-Request-Id': requestId } }
      );
    }
  }

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

  // Run all six tools in parallel. Pharmacogenomics needs gene → phenotype
  // genotypes; we hydrate from FHIR when SHARP context is present, otherwise
  // pass an empty record (PGx tool degrades gracefully to no calls).
  let genotypes: Record<string, string> = {};
  if (sharpHeaders) {
    try {
      const client = new FHIRClient();
      client.connect(sharpHeaders.fhirServerUrl, sharpHeaders.accessToken);
      genotypes = await loadPatientGenotypes(client, sharpHeaders.patientId);
    } catch (err) {
      console.error(JSON.stringify({
        ts: new Date().toISOString(),
        svc: 'web-api',
        level: 'warn',
        reqId: requestId,
        msg: 'PGx genotype fetch failed; PGx tool will run with no genotypes',
        error: (err as Error).message,
      }));
    }
  }
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
  //
  // Service URL is configurable via RISK_SCORE_SERVICE_URL (default
  // http://localhost:8001). The fetch is bounded by a 3-second
  // AbortController timeout so a hung scorer doesn't block the whole review.
  // Failure modes — connection refused, timeout, 5xx, malformed JSON — all
  // produce a structured `riskScore: { unavailable: true, reason }` payload
  // so the client can render a "score unavailable" badge instead of silently
  // showing nothing.
  const RISK_SCORE_URL = process.env['RISK_SCORE_SERVICE_URL'] ?? 'http://localhost:8001';
  const RISK_SCORE_TIMEOUT_MS = Number.parseInt(process.env['RISK_SCORE_TIMEOUT_MS'] ?? '3000', 10);
  let riskScore: unknown = { unavailable: true, reason: 'risk-score-not-attempted' };
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

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), RISK_SCORE_TIMEOUT_MS);
    let mlResponse: Response;
    try {
      mlResponse = await fetch(`${RISK_SCORE_URL}/risk-score`, {
        method: 'POST',
        signal: ctrl.signal,
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
    } finally {
      clearTimeout(timer);
    }
    if (mlResponse.ok) {
      riskScore = await mlResponse.json();
    } else {
      riskScore = {
        unavailable: true,
        reason: `risk-score-service-${mlResponse.status}`,
        url: RISK_SCORE_URL,
      };
    }
  } catch (err) {
    // Risk service not reachable / timed out / malformed response.
    // Always return a structured `unavailable` payload so the client renders
    // a degraded-state badge rather than a missing/null score.
    const e = err as Error;
    const reason = e.name === 'AbortError'
      ? `risk-score-timeout-${RISK_SCORE_TIMEOUT_MS}ms`
      : 'risk-score-service-down';
    riskScore = { unavailable: true, reason, error: e.message, url: RISK_SCORE_URL };
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      svc: 'web-api',
      level: 'warn',
      reqId: requestId,
      msg: 'ML risk-score fetch failed; returning unavailable badge',
      reason,
      url: RISK_SCORE_URL,
      error: e.message,
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
    dataSource,
    findingCounts: {
      cascade: cascade.length,
      dosing: dosing.length,
      deprescribing: deprescribing.length,
      pd: pd.length,
      pharmacogenomics: pharmacogenomics.length,
      lab: labMonitoring.length,
    },
  }));

  // Persist immutable snapshot so reports + clinician actions reference
  // the exact same clinical result the clinician saw. Failure is non-fatal
  // — log + continue so the user still gets the response. The trace id
  // makes failure correlatable with the source request.
  const responseBody = {
    reviewId,
    patientId,
    patientName,
    requestId,
    medications,
    riskScore,
    findings: outputs,
    toolStatus,
    timestamp: new Date().toISOString(),
  };
  try {
    saveReview({
      id: reviewId,
      patientId,
      createdAt: responseBody.timestamp,
      inputs: { medications, patientAge, patientContext: { age: patientAge, egfr } },
      outputs: { ...responseBody, dataSource },
      scorerVersion: (riskScore as { method?: string } | null)?.method ?? 'composite_heuristic_v1',
      appVersion: process.env['npm_package_version'] ?? '1.0.0',
    });
  } catch (err) {
    const e = err as Error;
    // Persistence failure is non-fatal — log with stack so operators can
    // diagnose, then serve the live response anyway. Common causes: DB file
    // permissions, disk full, native binding load failure (most often a
    // bundler config issue, see web/next.config.ts).
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      svc: 'web-api',
      level: 'warn',
      reqId: requestId,
      msg: 'Review snapshot save failed; serving live response anyway',
      reviewId,
      error: e.message,
      stack: e.stack,
    }));
  }

  return NextResponse.json(responseBody);
}
