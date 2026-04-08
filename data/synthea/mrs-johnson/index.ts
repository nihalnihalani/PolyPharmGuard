import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { FHIRPatient, FHIRMedicationRequest, FHIRObservation, FHIRCondition, FHIRBundle } from '../../../src/types/fhir.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadJSON<T>(filename: string): T {
  const filePath = join(__dirname, filename);
  const content = readFileSync(filePath, 'utf-8');
  return JSON.parse(content) as T;
}

export interface MrsJohnsonData {
  patient: FHIRPatient;
  medications: FHIRMedicationRequest[];
  observations: FHIRObservation[];
  conditions: FHIRCondition[];
}

export function loadMrsJohnsonData(): MrsJohnsonData {
  const patient = loadJSON<FHIRPatient>('patient.json');

  const medBundle = loadJSON<FHIRBundle<FHIRMedicationRequest>>('medications.json');
  const medications = (medBundle.entry ?? []).map(e => e.resource);

  const obsBundle = loadJSON<FHIRBundle<FHIRObservation>>('observations.json');
  const observations = (obsBundle.entry ?? []).map(e => e.resource);

  const condBundle = loadJSON<FHIRBundle<FHIRCondition>>('conditions.json');
  const conditions = (condBundle.entry ?? []).map(e => e.resource);

  return { patient, medications, observations, conditions };
}
