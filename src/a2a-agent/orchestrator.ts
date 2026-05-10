import type {
  FHIRPatient,
  FHIRMedicationRequest,
  FHIRObservation,
  FHIRCondition,
} from '../types/fhir.js';
import type {
  MedReviewReport,
  FHIRContextHeaders,
} from '../types/mcp.js';
import type {
  CascadeFinding,
  DosingFinding,
  DeprescribingFinding,
  LabMonitoringFinding,
  PatientContext,
  PDFinding,
  PGxFinding,
  TaperStep,
  RiskMatrixRow,
  PharmacyReviewItem,
  Severity,
} from '../types/clinical.js';
import { analyzeCascadeInteractions } from '../mcp-server/tools/cascade-interactions.js';
import { checkOrganFunctionDosing } from '../mcp-server/tools/organ-function-dosing.js';
import { screenDeprescribing } from '../mcp-server/tools/deprescribing-screen.js';
import { analyzePDInteractions } from '../mcp-server/tools/pd-interactions.js';
import { checkPharmacogenomics } from '../mcp-server/tools/pharmacogenomics.js';
import { checkLabMonitoring } from '../mcp-server/tools/lab-monitoring.js';
import { FHIRClient } from '../fhir/client.js';
import { loadPatientBundle } from '../fhir/queries.js';

export interface MedReviewRequest {
  patientId?: string;
  patient?: FHIRPatient;
  medications?: FHIRMedicationRequest[];
  observations?: FHIRObservation[];
  conditions?: FHIRCondition[];
  genotypes?: Record<string, string>;
  fhirContext?: FHIRContextHeaders;
}

type RecentLab = {
  loincCode: string;
  value: number;
  date: string;
  labName: string;
};

const SEVERITY_ORDER: Record<string, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MODERATE: 2,
  LOW: 3,
  INFO: 4,
  OK: 5,
};

function buildPatientContext(request: MedReviewRequest): PatientContext | null {
  if (!request.patient && !request.medications) return null;

  const patient: FHIRPatient = request.patient ?? {
    resourceType: 'Patient',
    id: request.patientId,
  };

  const medications = request.medications ?? [];
  const observations = request.observations ?? [];
  const conditions = request.conditions ?? [];

  let age: number | undefined;
  if (patient.birthDate) {
    const birth = new Date(patient.birthDate);
    const now = new Date();
    age = now.getFullYear() - birth.getFullYear();
    const m = now.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  }

  const getObsValue = (loincCode: string) =>
    (observations
      .filter(o => o.code?.coding?.some(c => c.code === loincCode))
      .sort((a, b) => (b.effectiveDateTime ?? '').localeCompare(a.effectiveDateTime ?? ''))[0])
      ?.valueQuantity?.value;

  return {
    patient,
    medications,
    observations,
    conditions,
    age,
    egfr: getObsValue('33914-3'),
    alt: getObsValue('1742-6'),
    ast: getObsValue('1920-8'),
    bilirubin: getObsValue('1975-2'),
  };
}

function getMedNames(medications: FHIRMedicationRequest[]): string[] {
  return medications.map(m =>
    m.medicationCodeableConcept?.coding?.[0]?.display ??
    m.medicationCodeableConcept?.text ??
    'Unknown Medication'
  );
}

function getMedDisplay(medication: FHIRMedicationRequest): string {
  return medication.medicationCodeableConcept?.coding?.[0]?.display ??
    medication.medicationCodeableConcept?.text ??
    'Unknown';
}

function medMatches(medicationName: string, findingDrug: string): boolean {
  const med = medicationName.toLowerCase();
  const drug = findingDrug.toLowerCase();
  return med.includes(drug) || drug.includes(med.split(' ')[0] ?? med);
}

function buildRecentLabs(observations: FHIRObservation[]): RecentLab[] {
  return observations
    .filter(o => o.valueQuantity)
    .map(o => ({
      loincCode: o.code.coding?.[0]?.code ?? '',
      value: o.valueQuantity!.value,
      date: o.effectiveDateTime ?? '',
      labName: o.code.text ?? o.code.coding?.[0]?.display ?? '',
    }));
}

function buildTalkNarrative(
  patient: FHIRPatient | undefined,
  age: number | undefined,
  conditions: FHIRCondition[],
  medications: FHIRMedicationRequest[],
  cascadeFindings: CascadeFinding[],
  dosingFindings: DosingFinding[],
  deprescribingFindings: DeprescribingFinding[],
  pdFindings: PDFinding[],
  pgxFindings: PGxFinding[],
  labFindings: LabMonitoringFinding[]
): string {
  const patientName = patient?.name?.[0]
    ? `${patient.name[0].prefix?.[0] ?? ''} ${patient.name[0].given?.[0] ?? ''} ${patient.name[0].family ?? ''}`.trim()
    : 'Patient';

  const ageStr = age ? `${age}-year-old` : '';
  const conditionList = conditions
    .slice(0, 3)
    .map(c => c.code?.coding?.[0]?.display ?? c.code?.text ?? '')
    .filter(Boolean)
    .join(', ');

  const criticalCount = [
    ...cascadeFindings.filter(f => f.severity === 'CRITICAL'),
    ...dosingFindings.filter(f => f.severity === 'CRITICAL'),
    ...deprescribingFindings.filter(f => f.severity === 'CRITICAL'),
    ...pdFindings.filter(f => f.severity === 'CRITICAL'),
    ...pgxFindings.filter(f => f.severity === 'CRITICAL'),
    ...labFindings.filter(f => f.severity === 'CRITICAL'),
  ].length;

  const highCount = [
    ...cascadeFindings.filter(f => f.severity === 'HIGH'),
    ...dosingFindings.filter(f => f.severity === 'HIGH'),
    ...deprescribingFindings.filter(f => f.severity === 'HIGH'),
    ...pdFindings.filter(f => f.severity === 'HIGH'),
    ...pgxFindings.filter(f => f.severity === 'HIGH'),
    ...labFindings.filter(f => f.severity === 'HIGH'),
  ].length;

  const moderateCount = [
    ...cascadeFindings.filter(f => f.severity === 'MODERATE'),
    ...dosingFindings.filter(f => f.severity === 'MODERATE'),
    ...deprescribingFindings.filter(f => f.severity === 'MODERATE'),
    ...pdFindings.filter(f => f.severity === 'MODERATE'),
    ...pgxFindings.filter(f => f.severity === 'MODERATE'),
    ...labFindings.filter(f => f.severity === 'MODERATE'),
  ].length;

  let narrative = `Medication review for ${patientName}${ageStr ? `, ${ageStr}` : ''}`;
  if (conditionList) narrative += ` with ${conditionList}`;
  narrative += `. `;
  narrative += `${medications.length} medications analyzed. `;
  narrative += `Findings: ${criticalCount} critical, ${highCount} high, ${moderateCount} moderate. `;

  const topCascade = cascadeFindings[0];
  const topDosing = dosingFindings[0];
  const topDepresc = deprescribingFindings[0];
  const topPD = pdFindings[0];
  const topPGx = pgxFindings[0];
  const topLab = labFindings[0];

  if (topCascade) {
    narrative += `Key cascade finding: ${topCascade.finding} — ${topCascade.clinicalConsequence}. `;
  }
  if (topDosing) {
    narrative += `Key dosing finding: ${topDosing.finding} — ${topDosing.recommendation}. `;
  }
  if (topDepresc) {
    narrative += `Deprescribing candidate: ${topDepresc.medication} — ${topDepresc.indicationStatus}. `;
  }
  if (topPD) {
    narrative += `Key pharmacodynamic finding: ${topPD.finding} — ${topPD.clinicalConsequence}. `;
  }
  if (topPGx) {
    narrative += `Key pharmacogenomics finding: ${topPGx.finding} — ${topPGx.consequence}. `;
  }
  if (topLab) {
    narrative += `Key lab monitoring gap: ${topLab.finding} — ${topLab.recommendation}. `;
  }

  if (criticalCount === 0 && highCount === 0 && moderateCount === 0) {
    narrative += 'No critical or high-priority medication safety concerns identified from available data.';
  } else {
    narrative += 'Immediate pharmacist review recommended for critical/high findings.';
  }

  return narrative;
}

function buildRiskMatrix(
  medications: FHIRMedicationRequest[],
  cascadeFindings: CascadeFinding[],
  dosingFindings: DosingFinding[],
  deprescribingFindings: DeprescribingFinding[],
  pdFindings: PDFinding[],
  pgxFindings: PGxFinding[],
  labFindings: LabMonitoringFinding[]
): RiskMatrixRow[] {
  return medications.map(med => {
    const medName = getMedDisplay(med);
    const medNameLower = medName.toLowerCase();

    const cascadeRisk = cascadeFindings
      .filter(f => f.finding.toLowerCase().includes(medNameLower) ||
        f.chain?.some(step => step.fact.toLowerCase().includes(medNameLower)))
      .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 5) - (SEVERITY_ORDER[b.severity] ?? 5))[0]
      ?.severity ?? 'OK';

    const pdRisk = pdFindings
      .filter(f => f.contributingDrugs.some(drug => medMatches(medName, drug)))
      .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 5) - (SEVERITY_ORDER[b.severity] ?? 5))[0]
      ?.severity ?? 'OK';

    const renalRisk = dosingFindings
      .filter(f => medMatches(medName, f.medication) &&
        f.finding.toLowerCase().includes('renal'))[0]
      ?.severity ?? 'OK';

    const hepaticRisk = dosingFindings
      .filter(f => medMatches(medName, f.medication) &&
        f.finding.toLowerCase().includes('hepatic'))[0]
      ?.severity ?? 'OK';

    const pgxFlag = pgxFindings
      .some(f => medMatches(medName, f.drug));

    const beersFlag = deprescribingFindings
      .some(f => f.medication.toLowerCase().includes(medNameLower) && !!f.beersFlag);

    const stoppfrailFlag = deprescribingFindings
      .some(f => f.medication.toLowerCase().includes(medNameLower) && !!f.stoppfrailFlag);

    const labGap = labFindings
      .some(f => medMatches(medName, f.drug));

    return {
      medication: medName,
      cascadeRisk,
      pdRisk,
      renalRisk,
      hepaticRisk,
      pgxFlag,
      beersFlag,
      stoppfrailFlag,
      labGap,
    };
  });
}

function buildTransactions(
  dosingFindings: DosingFinding[],
  medications: FHIRMedicationRequest[]
): FHIRMedicationRequest[] {
  const updates: FHIRMedicationRequest[] = [];

  for (const finding of dosingFindings.filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH')) {
    const matchingMed = medications.find(m => {
      const display = m.medicationCodeableConcept?.coding?.[0]?.display ??
        m.medicationCodeableConcept?.text ?? '';
      return display.toLowerCase().includes(finding.medication.toLowerCase()) ||
        finding.medication.toLowerCase().includes(display.toLowerCase());
    });

    if (matchingMed) {
      const shouldStop = finding.recommendation.toLowerCase().includes('contraindicated') ||
        finding.recommendation.toLowerCase().includes('discontinue');
      updates.push({
        ...matchingMed,
        id: `${matchingMed.id}-updated`,
        status: shouldStop ? 'stopped' : 'active',
      });
    }
  }

  return updates;
}

function buildPharmacyTasks(
  cascadeFindings: CascadeFinding[],
  dosingFindings: DosingFinding[],
  deprescribingFindings: DeprescribingFinding[],
  pdFindings: PDFinding[],
  pgxFindings: PGxFinding[],
  labFindings: LabMonitoringFinding[]
): PharmacyReviewItem[] {
  const tasks: PharmacyReviewItem[] = [];

  for (const finding of cascadeFindings.filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH')) {
    tasks.push({
      urgency: finding.severity,
      medication: finding.finding.split('\u2192')[0]?.replace(/^[A-Z0-9\s]+:/, '').trim() ?? 'Multiple medications',
      description: finding.finding,
      recommendedAction: finding.recommendation,
    });
  }

  for (const finding of dosingFindings.filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH')) {
    tasks.push({
      urgency: finding.severity,
      medication: finding.medication,
      description: finding.finding,
      recommendedAction: finding.recommendation,
    });
  }

  for (const finding of deprescribingFindings.filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH')) {
    tasks.push({
      urgency: finding.severity,
      medication: finding.medication,
      description: finding.finding,
      recommendedAction: finding.taperPlan?.length
        ? `Review deprescribing plan: ${finding.taperPlan.map(step => `week ${step.week}: ${step.dose}`).join('; ')}`
        : finding.indicationStatus,
    });
  }

  for (const finding of pdFindings.filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH')) {
    tasks.push({
      urgency: finding.severity,
      medication: finding.contributingDrugs.join(' + '),
      description: finding.finding,
      recommendedAction: finding.recommendation,
    });
  }

  for (const finding of pgxFindings.filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH')) {
    tasks.push({
      urgency: finding.severity,
      medication: finding.drug,
      description: finding.finding,
      recommendedAction: finding.recommendation,
    });
  }

  for (const finding of labFindings.filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH')) {
    tasks.push({
      urgency: finding.severity,
      medication: finding.drug,
      description: finding.finding,
      recommendedAction: finding.recommendation,
    });
  }

  return tasks;
}

/**
 * Hydrate a request that supplied only `patientId` + `fhirContext` but no
 * inline patient/medications/observations/conditions. Pulls the bundle from
 * the FHIR server and merges it into the request before downstream tools run.
 *
 * Inline data (when supplied) always wins — a caller that already loaded
 * patient state (web fixture path, e2e tests) is the source of truth and we
 * don't re-fetch over the network for them.
 *
 * On FHIR failure we log and return the request unchanged. Downstream tools
 * already degrade gracefully when patient context is empty, so a transient
 * FHIR outage produces a thin review (with INFO-level "context unavailable"
 * findings) rather than a 500.
 */
async function hydrateFromFHIR(request: MedReviewRequest): Promise<MedReviewRequest> {
  const hasInlineData =
    request.patient !== undefined ||
    (request.medications && request.medications.length > 0) ||
    (request.observations && request.observations.length > 0) ||
    (request.conditions && request.conditions.length > 0);
  if (hasInlineData) return request;

  if (!request.fhirContext) return request;
  const ctx = request.fhirContext;
  if (!ctx.fhirServerUrl || !ctx.accessToken || !ctx.patientId) return request;

  try {
    const client = new FHIRClient();
    client.connect(ctx.fhirServerUrl, ctx.accessToken);
    const bundle = await loadPatientBundle(client, ctx.patientId);
    return {
      ...request,
      patientId: request.patientId ?? ctx.patientId,
      patient: bundle.patient,
      medications: bundle.medications,
      observations: bundle.observations,
      conditions: bundle.conditions,
    };
  } catch (err) {
    console.error('[MedReview] FHIR hydration failed:', (err as Error).message);
    return request;
  }
}

export async function runMedicationReview(rawRequest: MedReviewRequest): Promise<MedReviewReport> {
  const request = await hydrateFromFHIR(rawRequest);
  const patientContext = buildPatientContext(request);
  const medications = request.medications ?? [];
  const medNames = getMedNames(medications);
  const recentLabs = buildRecentLabs(request.observations ?? []);
  const genotypes = request.genotypes ?? {};

  // Run all 6 tools in parallel with graceful degradation.
  const [
    cascadeResult,
    dosingResult,
    deprescribingResult,
    pdResult,
    pharmacogenomicsResult,
    labMonitoringResult,
  ] = await Promise.allSettled([
    analyzeCascadeInteractions({
      medications: medNames,
      patientContext,
    }),
    checkOrganFunctionDosing({
      medications: medNames,
      patientContext,
    }),
    screenDeprescribing({
      medications: medNames,
      patientContext,
    }),
    analyzePDInteractions({
      medications: medNames,
      patientContext,
    }),
    checkPharmacogenomics({
      medications: medNames,
      genotypes,
    }),
    checkLabMonitoring({
      medications: medNames,
      recentLabs,
      patientContext,
    }),
  ]);

  const cascadeFindings: CascadeFinding[] = cascadeResult.status === 'fulfilled'
    ? cascadeResult.value
    : [{
        finding: 'Cascade analysis unavailable: ' + (cascadeResult.reason as Error).message,
        severity: 'INFO' as Severity,
        chain: [],
        clinicalConsequence: 'Unable to complete cascade analysis.',
        recommendation: 'Manual pharmacist review recommended.',
        source: 'PolyPharmGuard MedReview agent — cascade tool error fallback',
      }];

  const dosingFindings: DosingFinding[] = dosingResult.status === 'fulfilled'
    ? dosingResult.value
    : [];

  const deprescribingFindings: DeprescribingFinding[] = deprescribingResult.status === 'fulfilled'
    ? deprescribingResult.value
    : [];

  const pdFindings: PDFinding[] = pdResult.status === 'fulfilled'
    ? pdResult.value
    : [];

  const pgxFindings: PGxFinding[] = pharmacogenomicsResult.status === 'fulfilled'
    ? pharmacogenomicsResult.value
    : [];

  const labFindings: LabMonitoringFinding[] = labMonitoringResult.status === 'fulfilled'
    ? labMonitoringResult.value
    : [];

  if (cascadeResult.status === 'rejected') {
    console.error('[MedReview] Cascade analysis failed:', (cascadeResult.reason as Error).message);
  }
  if (dosingResult.status === 'rejected') {
    console.error('[MedReview] Dosing check failed:', (dosingResult.reason as Error).message);
  }
  if (deprescribingResult.status === 'rejected') {
    console.error('[MedReview] Deprescribing screen failed:', (deprescribingResult.reason as Error).message);
  }
  if (pdResult.status === 'rejected') {
    console.error('[MedReview] PD interaction analysis failed:', (pdResult.reason as Error).message);
  }
  if (pharmacogenomicsResult.status === 'rejected') {
    console.error('[MedReview] Pharmacogenomics check failed:', (pharmacogenomicsResult.reason as Error).message);
  }
  if (labMonitoringResult.status === 'rejected') {
    console.error('[MedReview] Lab monitoring check failed:', (labMonitoringResult.reason as Error).message);
  }

  // Build 5Ts output
  const talk = buildTalkNarrative(
    request.patient,
    patientContext?.age,
    request.conditions ?? [],
    medications,
    cascadeFindings,
    dosingFindings,
    deprescribingFindings,
    pdFindings,
    pgxFindings,
    labFindings
  );

  const template: TaperStep[][] = deprescribingFindings
    .filter(f => f.taperPlan && f.taperPlan.length > 0)
    .map(f => f.taperPlan!);

  const table = buildRiskMatrix(
    medications,
    cascadeFindings,
    dosingFindings,
    deprescribingFindings,
    pdFindings,
    pgxFindings,
    labFindings
  );

  const transaction = buildTransactions(dosingFindings, medications);

  const task = buildPharmacyTasks(
    cascadeFindings,
    dosingFindings,
    deprescribingFindings,
    pdFindings,
    pgxFindings,
    labFindings
  );

  return {
    talk,
    template,
    table,
    transaction,
    task,
    findings: {
      cascade: cascadeFindings,
      dosing: dosingFindings,
      deprescribing: deprescribingFindings,
      pd: pdFindings,
      pharmacogenomics: pgxFindings,
      labMonitoring: labFindings,
    },
  };
}
