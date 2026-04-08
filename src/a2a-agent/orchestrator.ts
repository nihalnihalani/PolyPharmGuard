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
  PatientContext,
  TaperStep,
  RiskMatrixRow,
  PharmacyReviewItem,
  Severity,
} from '../types/clinical.js';
import { analyzeCascadeInteractions } from '../mcp-server/tools/cascade-interactions.js';
import { checkOrganFunctionDosing } from '../mcp-server/tools/organ-function-dosing.js';
import { screenDeprescribing } from '../mcp-server/tools/deprescribing-screen.js';

export interface MedReviewRequest {
  patientId?: string;
  patient?: FHIRPatient;
  medications?: FHIRMedicationRequest[];
  observations?: FHIRObservation[];
  conditions?: FHIRCondition[];
  fhirContext?: FHIRContextHeaders;
}

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
    observations
      .filter(o => o.code?.coding?.some(c => c.code === loincCode))
      .sort((a, b) => (b.effectiveDateTime ?? '').localeCompare(a.effectiveDateTime ?? ''))
      [0]?.valueQuantity?.value;

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

function buildTalkNarrative(
  patient: FHIRPatient | undefined,
  age: number | undefined,
  conditions: FHIRCondition[],
  medications: FHIRMedicationRequest[],
  cascadeFindings: CascadeFinding[],
  dosingFindings: DosingFinding[],
  deprescribingFindings: DeprescribingFinding[]
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
  ].length;

  const highCount = [
    ...cascadeFindings.filter(f => f.severity === 'HIGH'),
    ...dosingFindings.filter(f => f.severity === 'HIGH'),
    ...deprescribingFindings.filter(f => f.severity === 'HIGH'),
  ].length;

  const moderateCount = [
    ...cascadeFindings.filter(f => f.severity === 'MODERATE'),
    ...dosingFindings.filter(f => f.severity === 'MODERATE'),
    ...deprescribingFindings.filter(f => f.severity === 'MODERATE'),
  ].length;

  let narrative = `Medication review for ${patientName}${ageStr ? `, ${ageStr}` : ''}`;
  if (conditionList) narrative += ` with ${conditionList}`;
  narrative += `. `;
  narrative += `${medications.length} medications analyzed. `;
  narrative += `Findings: ${criticalCount} critical, ${highCount} high, ${moderateCount} moderate. `;

  const topCascade = cascadeFindings[0];
  const topDosing = dosingFindings[0];
  const topDepresc = deprescribingFindings[0];

  if (topCascade) {
    narrative += `Key cascade finding: ${topCascade.finding} — ${topCascade.clinicalConsequence}. `;
  }
  if (topDosing) {
    narrative += `Key dosing finding: ${topDosing.finding} — ${topDosing.recommendation}. `;
  }
  if (topDepresc) {
    narrative += `Deprescribing candidate: ${topDepresc.medication} — ${topDepresc.indicationStatus}. `;
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
  deprescribingFindings: DeprescribingFinding[]
): RiskMatrixRow[] {
  return medications.map(med => {
    const medName = med.medicationCodeableConcept?.coding?.[0]?.display ??
      med.medicationCodeableConcept?.text ?? 'Unknown';
    const medNameLower = medName.toLowerCase();

    const cascadeRisk = cascadeFindings
      .filter(f => f.finding.toLowerCase().includes(medNameLower) ||
        f.chain?.some(step => step.fact.toLowerCase().includes(medNameLower)))
      .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 5) - (SEVERITY_ORDER[b.severity] ?? 5))
      [0]?.severity ?? 'OK';

    const renalRisk = dosingFindings
      .filter(f => f.medication.toLowerCase().includes(medNameLower) &&
        f.finding.toLowerCase().includes('renal'))
      [0]?.severity ?? 'OK';

    const hepaticRisk = dosingFindings
      .filter(f => f.medication.toLowerCase().includes(medNameLower) &&
        f.finding.toLowerCase().includes('hepatic'))
      [0]?.severity ?? 'OK';

    const beersFlag = deprescribingFindings
      .some(f => f.medication.toLowerCase().includes(medNameLower) && !!f.beersFlag);

    const stoppfrailFlag = deprescribingFindings
      .some(f => f.medication.toLowerCase().includes(medNameLower) && !!f.stoppfrailFlag);

    return { medication: medName, cascadeRisk, renalRisk, hepaticRisk, beersFlag, stoppfrailFlag };
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
  dosingFindings: DosingFinding[]
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

  return tasks;
}

export async function runMedicationReview(request: MedReviewRequest): Promise<MedReviewReport> {
  const patientContext = buildPatientContext(request);
  const medications = request.medications ?? [];
  const medNames = getMedNames(medications);

  // Run all 3 tools in parallel with graceful degradation
  const [cascadeResult, dosingResult, deprescribingResult] = await Promise.allSettled([
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
  ]);

  const cascadeFindings: CascadeFinding[] = cascadeResult.status === 'fulfilled'
    ? cascadeResult.value
    : [{
        finding: 'Cascade analysis unavailable: ' + (cascadeResult.reason as Error).message,
        severity: 'INFO' as Severity,
        chain: [],
        clinicalConsequence: 'Unable to complete cascade analysis.',
        recommendation: 'Manual pharmacist review recommended.',
      }];

  const dosingFindings: DosingFinding[] = dosingResult.status === 'fulfilled'
    ? dosingResult.value
    : [];

  const deprescribingFindings: DeprescribingFinding[] = deprescribingResult.status === 'fulfilled'
    ? deprescribingResult.value
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

  // Build 5Ts output
  const talk = buildTalkNarrative(
    request.patient,
    patientContext?.age,
    request.conditions ?? [],
    medications,
    cascadeFindings,
    dosingFindings,
    deprescribingFindings
  );

  const template: TaperStep[][] = deprescribingFindings
    .filter(f => f.taperPlan && f.taperPlan.length > 0)
    .map(f => f.taperPlan!);

  const table = buildRiskMatrix(medications, cascadeFindings, dosingFindings, deprescribingFindings);

  const transaction = buildTransactions(dosingFindings, medications);

  const task = buildPharmacyTasks(cascadeFindings, dosingFindings);

  return { talk, template, table, transaction, task };
}
