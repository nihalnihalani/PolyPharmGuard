import type { PatientContext } from '../types/clinical.js';
import type { FHIRObservation } from '../types/fhir.js';
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
