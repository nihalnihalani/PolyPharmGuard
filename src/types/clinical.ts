export type CYPEnzyme = 'CYP3A4' | 'CYP2D6' | 'CYP2C9' | 'CYP2C19' | 'CYP1A2' | 'CYP2B6';

export type Severity = 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW' | 'INFO';

export interface CYPRelationship {
  enzyme: CYPEnzyme;
  role: string;
  source: string;
}

export interface DrugKBEntry {
  drug: string;
  rxnormCui: string;
  cypRelationships: CYPRelationship[];
}

export interface CascadeChainStep {
  step: number;
  fact: string;
  source: string;
}

export interface CascadeFinding {
  finding: string;
  severity: Severity;
  chain: CascadeChainStep[];
  clinicalConsequence: string;
  recommendation: string;
  faersSignal?: string;
}

export interface DosingFinding {
  finding: string;
  severity: Severity;
  medication: string;
  patientEgfr?: number;
  egfrSource?: string;
  threshold: string;
  recommendation: string;
  alternative?: string;
}

export interface TaperStep {
  week: number;
  dose: string;
}

export interface DeprescribingFinding {
  finding: string;
  severity: Severity;
  medication: string;
  duration?: string;
  indicationStatus: string;
  guideline: string;
  beersFlag?: string;
  stoppfrailFlag?: string;
  taperPlan?: TaperStep[];
}

export interface PatientContext {
  patient: import('./fhir.js').FHIRPatient;
  medications: import('./fhir.js').FHIRMedicationRequest[];
  observations: import('./fhir.js').FHIRObservation[];
  conditions: import('./fhir.js').FHIRCondition[];
  age?: number;
  egfr?: number;
  alt?: number;
  ast?: number;
  bilirubin?: number;
}

export interface RiskMatrixRow {
  medication: string;
  cascadeRisk: Severity | 'OK';
  renalRisk: Severity | 'OK';
  hepaticRisk: Severity | 'OK';
  beersFlag: boolean;
  stoppfrailFlag: boolean;
}

export interface PharmacyReviewItem {
  urgency: Severity;
  medication: string;
  description: string;
  recommendedAction: string;
}
