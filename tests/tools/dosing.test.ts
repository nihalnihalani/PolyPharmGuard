import { describe, it, expect, vi, beforeAll } from 'vitest';

vi.mock('../../src/llm/gemini.js', () => ({
  analyzeWithGemini: vi.fn().mockResolvedValue('[]'),
  isGeminiAvailable: vi.fn().mockReturnValue(false),
  initGemini: vi.fn(),
}));

vi.mock('../../src/llm/guardrails.js', () => ({
  validateClinicalOutput: vi.fn().mockReturnValue({ valid: true, warnings: [] }),
  ensureNoFHIRCredentials: vi.fn((p: string) => p),
}));

vi.mock('../../src/mcp-server/prompts/dosing-prompt.js', () => ({
  buildDosingPrompt: vi.fn().mockReturnValue({ systemPrompt: '', userPrompt: '' }),
}));

let checkOrganFunctionDosing: typeof import('../../src/mcp-server/tools/organ-function-dosing.js')['checkOrganFunctionDosing'];

beforeAll(async () => {
  const module = await import('../../src/mcp-server/tools/organ-function-dosing.js');
  checkOrganFunctionDosing = module.checkOrganFunctionDosing;
});

const mockPatientContextEgfr28 = {
  patient: { resourceType: 'Patient' as const, id: 'test-001', birthDate: '1947-08-15' },
  medications: [],
  observations: [],
  conditions: [],
  age: 78,
  egfr: 28,
  alt: 22,
  ast: 25,
  bilirubin: 0.8,
};

describe('check_organ_function_dosing', () => {
  describe('renal dosing alerts', () => {
    it('flags metformin at eGFR 28 as CRITICAL (contraindicated)', async () => {
      const findings = await checkOrganFunctionDosing({
        medications: ['Metformin 1000mg BID'],
        patientContext: mockPatientContextEgfr28,
      });

      const metforminFinding = findings.find(f =>
        f.medication.toLowerCase().includes('metformin')
      );
      expect(metforminFinding).toBeDefined();
      expect(metforminFinding!.severity).toBe('CRITICAL');
      expect(metforminFinding!.patientEgfr).toBe(28);
    });

    it('flags metformin at exactly eGFR 30 as CRITICAL (contraindicated)', async () => {
      const findings = await checkOrganFunctionDosing({
        medications: ['Metformin 1000mg BID'],
        patientContext: { ...mockPatientContextEgfr28, egfr: 30 },
      });

      const metforminFinding = findings.find(f =>
        f.medication.toLowerCase().includes('metformin')
      );
      expect(metforminFinding).toBeDefined();
      expect(metforminFinding!.severity).toBe('CRITICAL');
      expect(metforminFinding!.patientEgfr).toBe(30);
    });

    it('flags gabapentin dose adjustment at eGFR 28', async () => {
      const findings = await checkOrganFunctionDosing({
        medications: ['Gabapentin 300mg TID'],
        patientContext: mockPatientContextEgfr28,
      });

      const gabapentinFinding = findings.find(f =>
        f.medication.toLowerCase().includes('gabapentin')
      );
      expect(gabapentinFinding).toBeDefined();
      expect(['CRITICAL', 'HIGH', 'MODERATE']).toContain(gabapentinFinding!.severity);
    });

    it('does not flag amlodipine (no renal adjustment needed)', async () => {
      const findings = await checkOrganFunctionDosing({
        medications: ['Amlodipine 10mg'],
        patientContext: mockPatientContextEgfr28,
      });

      // Amlodipine's renal dosing entry has "No renal dose adjustment required" for all eGFR ranges
      // The algorithmic check skips entries starting with "No renal" or "No dose adjustment" or "Standard"
      const amlodipineFinding = findings.find(f =>
        f.medication.toLowerCase().includes('amlodipine') &&
        f.severity !== 'INFO'
      );
      expect(amlodipineFinding).toBeUndefined();
    });
  });

  describe('missing data handling', () => {
    it('handles null patientContext gracefully', async () => {
      const findings = await checkOrganFunctionDosing({
        medications: ['Metformin 1000mg'],
        patientContext: null,
      });

      expect(Array.isArray(findings)).toBe(true);
      // Should return INFO finding about missing data
      const infoFinding = findings.find(f => f.severity === 'INFO');
      expect(infoFinding).toBeDefined();
    });

    it('handles empty medication list', async () => {
      const findings = await checkOrganFunctionDosing({
        medications: [],
        patientContext: mockPatientContextEgfr28,
      });
      expect(findings).toEqual([]);
    });
  });

  describe('output quality', () => {
    it('flagged findings include the patient eGFR value', async () => {
      const findings = await checkOrganFunctionDosing({
        medications: ['Metformin 1000mg BID'],
        patientContext: mockPatientContextEgfr28,
      });

      const metforminFinding = findings.find(f =>
        f.medication.toLowerCase().includes('metformin')
      );
      if (metforminFinding) {
        expect(metforminFinding.patientEgfr).toBe(28);
      }
    });

    it('findings include threshold information', async () => {
      const findings = await checkOrganFunctionDosing({
        medications: ['Metformin 1000mg BID'],
        patientContext: mockPatientContextEgfr28,
      });

      for (const finding of findings.filter(f => f.severity !== 'INFO')) {
        expect(finding.threshold).toBeTruthy();
        expect(finding.recommendation).toBeTruthy();
      }
    });
  });

  describe('FHIR dosageInstruction → actual daily dose math (item 10)', () => {
    it('computes gabapentin 300mg TID → 900mg/day and surfaces the ceiling', async () => {
      const ctx = {
        ...mockPatientContextEgfr28,
        medications: [{
          resourceType: 'MedicationRequest' as const,
          id: 'test-medreq-gaba',
          status: 'active' as const,
          intent: 'order' as const,
          subject: { reference: 'Patient/test-001' },
          medicationCodeableConcept: {
            coding: [{ system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code: '25480', display: 'Gabapentin' }],
            text: 'Gabapentin 300mg',
          },
          dosageInstruction: [{
            text: '300mg three times daily',
            timing: { repeat: { frequency: 3, period: 1, periodUnit: 'd' } },
            doseAndRate: [{ doseQuantity: { value: 300, unit: 'mg' } }],
          }],
          authoredOn: '2026-01-15',
        }],
      };
      const findings = await checkOrganFunctionDosing({
        medications: ['Gabapentin 300mg'],
        patientContext: ctx,
      });
      const gaba = findings.find(f => f.medication.toLowerCase().includes('gabapentin'));
      expect(gaba).toBeDefined();
      expect(gaba!.actualDailyDose).toEqual({ value: 900, unit: 'mg' });
      expect(gaba!.recommendedDailyMaxAtEgfr).toEqual({ value: 300, unit: 'mg' });
      expect(gaba!.finding).toMatch(/900mg\/day EXCEEDS .* 300mg\/day/);
    });

    it('falls back to legacy wording when dosageInstruction is missing', async () => {
      const findings = await checkOrganFunctionDosing({
        medications: ['Gabapentin 300mg'],
        patientContext: mockPatientContextEgfr28, // no medications array → no dose math
      });
      const gaba = findings.find(f => f.medication.toLowerCase().includes('gabapentin'));
      expect(gaba).toBeDefined();
      expect(gaba!.actualDailyDose).toBeUndefined();
      // Legacy "requires attention at eGFR …" wording
      expect(gaba!.finding).toMatch(/requires attention at eGFR/);
    });
  });
});
