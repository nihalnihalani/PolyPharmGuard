import type { PatientContext } from '../types/clinical.js';
import type {
  FHIRObservation,
  FHIRPatient,
  FHIRMedicationRequest,
  FHIRCondition,
} from '../types/fhir.js';
import type { FHIRClient } from './client.js';

function getAge(birthDate: string): number {
  const birth = new Date(birthDate);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age;
}

function getLatestObservationValue(observations: FHIRObservation[], loincCode: string): number | undefined {
  const matching = observations
    .filter(o => o.code?.coding?.some(c => c.code === loincCode))
    .sort((a, b) => {
      const dateA = a.effectiveDateTime ?? '';
      const dateB = b.effectiveDateTime ?? '';
      return dateB.localeCompare(dateA);
    });
  return matching[0]?.valueQuantity?.value;
}

export async function getPatientContext(client: FHIRClient, patientId: string): Promise<PatientContext> {
  const patient = await client.getPatient(patientId);

  const [medsResult, obsResult, condResult] = await Promise.allSettled([
    client.getMedications(patientId),
    client.getObservations(patientId, ['33914-3', '1742-6', '1920-8', '1975-2']),
    client.getConditions(patientId),
  ]);

  const medications = medsResult.status === 'fulfilled' ? medsResult.value : [];
  const observations = obsResult.status === 'fulfilled' ? obsResult.value : [];
  const conditions = condResult.status === 'fulfilled' ? condResult.value : [];

  const age = patient.birthDate ? getAge(patient.birthDate) : undefined;
  const egfr = getLatestObservationValue(observations, '33914-3');
  const alt = getLatestObservationValue(observations, '1742-6');
  const ast = getLatestObservationValue(observations, '1920-8');
  const bilirubin = getLatestObservationValue(observations, '1975-2');

  return { patient, medications, observations, conditions, age, egfr, alt, ast, bilirubin };
}

export interface PatientBundle {
  patient: FHIRPatient;
  medications: FHIRMedicationRequest[];
  observations: FHIRObservation[];
  conditions: FHIRCondition[];
  age?: number;
  egfr?: number;
  alt?: number;
  ast?: number;
  bilirubin?: number;
}

/**
 * Aggregate Patient + active MedicationRequests + recent Observations +
 * active Conditions into the shape consumed by the A2A orchestrator and the
 * web review endpoint when a real SHARP-on-FHIR launch is in play.
 *
 * Differences vs. {@link getPatientContext}:
 * - Uses {@link FHIRClient.getObservationsSince} (last 180 days, no LOINC
 *   filter) instead of the four-LOINC summary fetch, so downstream tools
 *   (lab-monitoring especially) can see the full panel.
 * - Returns the raw resources alongside derived scalars so the orchestrator
 *   can pass them straight into tool handlers.
 *
 * Failures of any one query degrade gracefully: a missing Observations sweep
 * still returns a usable patient + meds bundle. The orchestrator decides
 * whether downstream analysis is meaningful with what we have.
 */
export async function loadPatientBundle(
  client: FHIRClient,
  patientId: string,
  observationSinceDays: number = 180
): Promise<PatientBundle> {
  const patient = await client.getPatient(patientId);

  const [medsResult, obsResult, condResult] = await Promise.allSettled([
    client.getMedications(patientId),
    client.getObservationsSince(patientId, observationSinceDays),
    client.getConditions(patientId),
  ]);

  const medications = medsResult.status === 'fulfilled' ? medsResult.value : [];
  const observations = obsResult.status === 'fulfilled' ? obsResult.value : [];
  const conditions = condResult.status === 'fulfilled' ? condResult.value : [];

  const age = patient.birthDate ? getAge(patient.birthDate) : undefined;
  const egfr = getLatestObservationValue(observations, '33914-3');
  const alt = getLatestObservationValue(observations, '1742-6');
  const ast = getLatestObservationValue(observations, '1920-8');
  const bilirubin = getLatestObservationValue(observations, '1975-2');

  return { patient, medications, observations, conditions, age, egfr, alt, ast, bilirubin };
}

/**
 * Fetch all Observations for a patient within the lookback window. Used by
 * the lab-monitoring tool when no labs were pre-loaded by the caller — the
 * tool needs to see the full lab panel to decide what's missing/overdue.
 *
 * Defaults to 180 days because most monitoring intervals (warfarin INR
 * weekly, lithium quarterly, digoxin annually) fit comfortably in that
 * window and longer history pulls bytes we won't use.
 */
export async function loadPatientObservations(
  client: FHIRClient,
  patientId: string,
  sinceDays: number = 180
): Promise<FHIRObservation[]> {
  return client.getObservationsSince(patientId, sinceDays);
}
