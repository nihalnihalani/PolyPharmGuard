import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type {
  FHIRPatient,
  FHIRMedicationRequest,
  FHIRObservation,
  FHIRCondition,
  FHIRBundle,
} from '../../../src/types/fhir.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadJSON<T>(filename: string): T {
  const filePath = join(__dirname, filename);
  const content = readFileSync(filePath, 'utf-8');
  return JSON.parse(content) as T;
}

export interface MrPatelData {
  patient: FHIRPatient;
  medications: FHIRMedicationRequest[];
  observations: FHIRObservation[];
  conditions: FHIRCondition[];
}

/**
 * Mr. Raj Patel — synthetic 62yo male demonstrating the AI Factor:
 * a 3-step CYP cascade that pairwise interaction checkers cannot find.
 *
 * Hero finding: Fluvoxamine (strong CYP2C19 inhibitor) blocks bioactivation
 * of clopidogrel (CYP2C19 substrate prodrug) → loss of antiplatelet effect →
 * increased stent thrombosis risk in a post-DES patient. Standard pairwise
 * checkers do NOT flag clopidogrel + fluvoxamine.
 */
export function loadMrPatelData(): MrPatelData {
  const patient = loadJSON<FHIRPatient>('patient.json');

  const medBundle = loadJSON<FHIRBundle<FHIRMedicationRequest>>('medications.json');
  const medications = (medBundle.entry ?? []).map((e) => e.resource);

  const obsBundle = loadJSON<FHIRBundle<FHIRObservation>>('observations.json');
  const observations = (obsBundle.entry ?? []).map((e) => e.resource);

  const condBundle = loadJSON<FHIRBundle<FHIRCondition>>('conditions.json');
  const conditions = (condBundle.entry ?? []).map((e) => e.resource);

  return { patient, medications, observations, conditions };
}
