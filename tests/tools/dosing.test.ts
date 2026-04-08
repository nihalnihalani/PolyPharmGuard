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
});
