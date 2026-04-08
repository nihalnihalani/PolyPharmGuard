import { describe, it, expect, vi, beforeAll } from 'vitest';
import type { FHIRMedicationRequest, FHIRCondition } from '../../src/types/fhir.js';

vi.mock('../../src/llm/gemini.js', () => ({
  analyzeWithGemini: vi.fn().mockResolvedValue('[]'),
  isGeminiAvailable: vi.fn().mockReturnValue(false),
  initGemini: vi.fn(),
}));

vi.mock('../../src/llm/guardrails.js', () => ({
  validateClinicalOutput: vi.fn().mockReturnValue({ valid: true, warnings: [] }),
  ensureNoFHIRCredentials: vi.fn((p: string) => p),
}));

vi.mock('../../src/mcp-server/prompts/deprescribing-prompt.js', () => ({
  buildDeprescribingPrompt: vi.fn().mockReturnValue({ systemPrompt: '', userPrompt: '' }),
}));

let screenDeprescribing: typeof import('../../src/mcp-server/tools/deprescribing-screen.js')['screenDeprescribing'];

beforeAll(async () => {
  const module = await import('../../src/mcp-server/tools/deprescribing-screen.js');
  screenDeprescribing = module.screenDeprescribing;
});

const omeprazoleMedReq: FHIRMedicationRequest = {
  resourceType: 'MedicationRequest',
  id: 'medreq-006',
  status: 'active',
  intent: 'order',
  subject: { reference: 'Patient/test-001' },
  medicationCodeableConcept: {
    coding: [{ system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code: '7646', display: 'Omeprazole' }],
    text: 'Omeprazole 40mg',
  },
  authoredOn: '2024-10-01', // ~78 weeks ago from 2026-04-08
};

const warfarinMedReq: FHIRMedicationRequest = {
  resourceType: 'MedicationRequest',
  id: 'medreq-005',
  status: 'active',
  intent: 'order',
  subject: { reference: 'Patient/test-001' },
  medicationCodeableConcept: {
    coding: [{ system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code: '11289', display: 'Warfarin' }],
    text: 'Warfarin 5mg',
  },
  authoredOn: '2025-01-15',
};

const afibCondition: FHIRCondition = {
  resourceType: 'Condition',
  id: 'cond-afib',
  clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }] },
  code: { coding: [{ system: 'http://snomed.info/sct', code: '49436004', display: 'Atrial fibrillation (disorder)' }], text: 'Atrial Fibrillation' },
  subject: { reference: 'Patient/test-001' },
};

describe('screen_deprescribing', () => {
  describe('Beers Criteria screening', () => {
    it('identifies omeprazole as deprescribing candidate for 78yo without GI indication', async () => {
      const findings = await screenDeprescribing({
        medications: [omeprazoleMedReq],
        patientContext: {
          patient: { resourceType: 'Patient', id: 'test-001', birthDate: '1947-08-15' },
          medications: [omeprazoleMedReq],
          observations: [],
          conditions: [], // No GERD/Barrett's
          age: 78,
        },
        patientAge: 78,
      });

      const omeprazoleFinding = findings.find(f =>
        f.medication.toLowerCase().includes('omeprazole')
      );
      expect(omeprazoleFinding).toBeDefined();
      expect(omeprazoleFinding!.beersFlag).toBeTruthy();
    });

    it('does not flag omeprazole for patient under 65', async () => {
      const findings = await screenDeprescribing({
        medications: ['Omeprazole 40mg'],
        patientContext: {
          patient: { resourceType: 'Patient', id: 'test-002', birthDate: '1990-01-01' },
          medications: [],
          observations: [],
          conditions: [],
          age: 36,
        },
        patientAge: 36,
      });

      const omeprazoleFinding = findings.find(f =>
        f.medication.toLowerCase().includes('omeprazole') && f.beersFlag
      );
      expect(omeprazoleFinding).toBeUndefined();
    });
  });

  describe('taper plan generation', () => {
    it('generates taper plan for omeprazole', async () => {
      const findings = await screenDeprescribing({
        medications: [omeprazoleMedReq],
        patientContext: {
          patient: { resourceType: 'Patient', id: 'test-001', birthDate: '1947-08-15' },
          medications: [omeprazoleMedReq],
          observations: [],
          conditions: [],
          age: 78,
        },
        patientAge: 78,
      });

      const omeprazoleFinding = findings.find(f =>
        f.medication.toLowerCase().includes('omeprazole')
      );

      if (omeprazoleFinding) {
        expect(omeprazoleFinding.taperPlan).toBeDefined();
        expect(omeprazoleFinding.taperPlan!.length).toBeGreaterThanOrEqual(3);
        // Should have sequential week numbers
        const weeks = omeprazoleFinding.taperPlan!.map(s => s.week);
        expect(weeks[0]).toBe(1);
      }
    });
  });

  describe('condition-aware screening', () => {
    it('does not recommend stopping warfarin when AFib is documented', async () => {
      const findings = await screenDeprescribing({
        medications: [warfarinMedReq],
        patientContext: {
          patient: { resourceType: 'Patient', id: 'test-001', birthDate: '1947-08-15' },
          medications: [warfarinMedReq],
          observations: [],
          conditions: [afibCondition],
          age: 78,
        },
        patientAge: 78,
      });

      // Warfarin should NOT be a deprescribing candidate when AFib is present
      // The code explicitly checks hasIndication for warfarin and sets shouldFlag = false
      const warfarinFinding = findings.find(f =>
        f.medication.toLowerCase().includes('warfarin')
      );
      expect(warfarinFinding).toBeUndefined();
    });

    it('handles empty conditions list without crashing', async () => {
      const findings = await screenDeprescribing({
        medications: ['Simvastatin 40mg'],
        patientContext: {
          patient: { resourceType: 'Patient', id: 'test-001', birthDate: '1947-08-15' },
          medications: [],
          observations: [],
          conditions: [],
          age: 78,
        },
      });
      expect(Array.isArray(findings)).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('handles empty medication list', async () => {
      const findings = await screenDeprescribing({
        medications: [],
        patientContext: null,
      });
      expect(findings).toEqual([]);
    });
  });
});
