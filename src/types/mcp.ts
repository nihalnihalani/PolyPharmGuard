import type { CascadeFinding, DosingFinding, DeprescribingFinding, TaperStep, RiskMatrixRow, PharmacyReviewItem } from './clinical.js';
import type { FHIRMedicationRequest } from './fhir.js';

export interface FHIRContextHeaders {
  fhirServerUrl: string;
  accessToken: string;
  patientId: string;
}

export interface CascadeInput {
  medications: string[];
  patientId?: string;
  fhirContext?: FHIRContextHeaders;
}

export interface CascadeOutput {
  findings: CascadeFinding[];
  medicationsAnalyzed: number;
  cascadesDetected: number;
  timestamp: string;
}

export interface DosingInput {
  medications: string[];
  patientId?: string;
  fhirContext?: FHIRContextHeaders;
}

export interface DosingOutput {
  findings: DosingFinding[];
  medicationsAnalyzed: number;
  adjustmentsNeeded: number;
  timestamp: string;
}

export interface DeprescribingInput {
  medications: string[];
  patientId?: string;
  fhirContext?: FHIRContextHeaders;
  patientAge?: number;
}

export interface DeprescribingOutput {
  findings: DeprescribingFinding[];
  medicationsScreened: number;
  candidatesFound: number;
  timestamp: string;
}

export interface MedReviewReport {
  talk: string;
  template: TaperStep[][];
  table: RiskMatrixRow[];
  transaction: FHIRMedicationRequest[];
  task: PharmacyReviewItem[];
}
