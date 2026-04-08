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

// Pharmacodynamic interaction types
export type PDClass = 'CNS_DEPRESSION' | 'QT_PROLONGATION' | 'BLEEDING_RISK' | 'SEROTONIN_SYNDROME' | 'HYPOTENSION';

export interface PDInteractionEntry {
  id: string;
  class: PDClass;
  drugClass: string;
  specificDrugs: string[];
  mechanism: string;
  severity: Severity;
  consequence: string;
  source: string;
  riskScoreWeight: number;
}

export interface PDFinding {
  finding: string;
  severity: Severity;
  class: PDClass;
  contributingDrugs: string[];
  mechanism: string;
  clinicalConsequence: string;
  recommendation: string;
  riskScore: number;
  source: string;
}

// Pharmacogenomics types
export type CYPPhenotype = 'poor_metabolizer' | 'intermediate_metabolizer' | 'normal_metabolizer' | 'rapid_metabolizer' | 'ultrarapid_metabolizer';

export interface PGxEntry {
  gene: string;
  phenotype: CYPPhenotype;
  drug: string;
  rxnormCui: string;
  consequence: string;
  recommendation: string;
  severity: Severity;
  source: string;
}

export interface PGxFinding {
  finding: string;
  severity: Severity;
  drug: string;
  gene: string;
  phenotype: CYPPhenotype;
  consequence: string;
  recommendation: string;
  source: string;
}

// Lab monitoring types
export interface LabRequirement {
  labName: string;
  loincCode: string;
  monitoringFrequencyDays: number;
  therapeuticRange?: { min: number; max: number; unit: string };
  actionThreshold?: { criticalLow?: number; criticalHigh?: number };
  action: string;
  source: string;
}

export interface LabMonitoringEntry {
  drug: string;
  rxnormCui: string;
  requiredLabs: LabRequirement[];
}

export interface LabMonitoringFinding {
  finding: string;
  severity: Severity;
  drug: string;
  labName: string;
  loincCode: string;
  lastResultDate?: string;
  lastResultValue?: number;
  daysSinceLastCheck?: number;
  status: 'MISSING' | 'OVERDUE' | 'OUT_OF_RANGE' | 'CURRENT';
  recommendation: string;
  source: string;
}

// Risk score type (returned by ML service)
export interface RiskScore {
  score: number;           // 0-100
  probability90Day: number; // 0.0-1.0
  features: Record<string, number>;
  interpretation: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
}
