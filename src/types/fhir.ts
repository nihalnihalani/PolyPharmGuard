export interface FHIRCoding {
  system: string;
  code: string;
  display?: string;
}

export interface FHIRCodeableConcept {
  coding?: FHIRCoding[];
  text?: string;
}

export interface FHIRPatient {
  resourceType: 'Patient';
  id?: string;
  birthDate?: string;
  gender?: string;
  name?: Array<{
    given?: string[];
    family?: string;
    prefix?: string[];
  }>;
  address?: Array<{
    line?: string[];
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  }>;
  identifier?: Array<{
    system?: string;
    value?: string;
  }>;
}

export interface FHIRDosageInstruction {
  text?: string;
  timing?: {
    repeat?: {
      frequency?: number;
      period?: number;
      periodUnit?: string;
    };
  };
  doseAndRate?: Array<{
    doseQuantity?: {
      value: number;
      unit: string;
    };
  }>;
  route?: FHIRCodeableConcept;
}

export interface FHIRMedicationRequest {
  resourceType: 'MedicationRequest';
  id?: string;
  status: string;
  intent: string;
  subject: { reference: string };
  medicationCodeableConcept: FHIRCodeableConcept;
  dosageInstruction?: FHIRDosageInstruction[];
  authoredOn?: string;
}

export interface FHIRObservation {
  resourceType: 'Observation';
  id?: string;
  status: string;
  code: FHIRCodeableConcept;
  subject: { reference: string };
  valueQuantity?: {
    value: number;
    unit: string;
    system?: string;
    code?: string;
  };
  effectiveDateTime?: string;
}

export interface FHIRCondition {
  resourceType: 'Condition';
  id?: string;
  clinicalStatus?: FHIRCodeableConcept;
  verificationStatus?: FHIRCodeableConcept;
  code: FHIRCodeableConcept;
  subject: { reference: string };
  onsetDateTime?: string;
}

export interface FHIRBundle<T> {
  resourceType: 'Bundle';
  type: string;
  total?: number;
  entry?: Array<{
    resource: T;
    fullUrl?: string;
  }>;
}

export interface FHIROperationOutcome {
  resourceType: 'OperationOutcome';
  issue: Array<{
    severity: string;
    code: string;
    diagnostics?: string;
  }>;
}
