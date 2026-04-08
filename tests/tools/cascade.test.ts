import { describe, it, expect, vi, beforeAll } from 'vitest';

// Mock Gemini to return empty array (test algorithmic layer only)
vi.mock('../../src/llm/gemini.js', () => ({
  analyzeWithGemini: vi.fn().mockResolvedValue('[]'),
  isGeminiAvailable: vi.fn().mockReturnValue(false),
  initGemini: vi.fn(),
}));

// Mock guardrails to pass through
vi.mock('../../src/llm/guardrails.js', () => ({
  validateClinicalOutput: vi.fn().mockReturnValue({ valid: true, warnings: [] }),
  ensureNoFHIRCredentials: vi.fn((p: string) => p),
}));

// Mock cascade prompt builder
vi.mock('../../src/mcp-server/prompts/cascade-prompt.js', () => ({
  buildCascadePrompt: vi.fn().mockReturnValue({ systemPrompt: '', userPrompt: '' }),
}));

let analyzeCascadeInteractions: typeof import('../../src/mcp-server/tools/cascade-interactions.js')['analyzeCascadeInteractions'];

beforeAll(async () => {
  const module = await import('../../src/mcp-server/tools/cascade-interactions.js');
  analyzeCascadeInteractions = module.analyzeCascadeInteractions;
});

describe('analyze_cascade_interactions', () => {
  describe('CYP3A4 cascade detection', () => {
    it('detects fluconazole->simvastatin CYP3A4 cascade', async () => {
      const findings = await analyzeCascadeInteractions({
        medications: ['Fluconazole 200mg', 'Simvastatin 40mg'],
      });

      expect(findings.length).toBeGreaterThanOrEqual(1);

      const cascade = findings.find(f =>
        f.chain?.some(s => s.fact.toLowerCase().includes('fluconazole')) &&
        f.chain?.some(s => s.fact.toLowerCase().includes('simvastatin'))
      );
      expect(cascade).toBeDefined();
      // Fluconazole is a strong CYP3A4 inhibitor + simvastatin is major substrate = HIGH
      expect(['CRITICAL', 'HIGH']).toContain(cascade!.severity);
    });

    it('detects fluconazole->warfarin CYP2C9 interaction', async () => {
      const findings = await analyzeCascadeInteractions({
        medications: ['Fluconazole 200mg', 'Warfarin 5mg'],
      });

      const warfarinCascade = findings.find(f =>
        f.finding.toLowerCase().includes('warfarin') ||
        f.chain?.some(s => s.fact.toLowerCase().includes('warfarin'))
      );
      expect(warfarinCascade).toBeDefined();
    });
  });

  describe('edge cases', () => {
    it('handles empty medication list', async () => {
      const findings = await analyzeCascadeInteractions({ medications: [] });
      expect(findings).toEqual([]);
    });

    it('handles drugs with no CYP relationships without crashing', async () => {
      const findings = await analyzeCascadeInteractions({
        medications: ['Potassium Chloride 20mEq', 'Lisinopril 20mg'],
      });
      expect(Array.isArray(findings)).toBe(true);
    });

    it('flags unknown drugs as requiring manual review', async () => {
      const findings = await analyzeCascadeInteractions({
        medications: ['Zomgpfizer 500mg unknownDrug'],
      });
      expect(Array.isArray(findings)).toBe(true);
      // Unknown drugs should get an INFO-level manual review flag
      const manualReview = findings.find(f =>
        f.finding.toLowerCase().includes('manual review') ||
        f.severity === 'INFO'
      );
      expect(manualReview).toBeDefined();
    });
  });

  describe('evidence chain quality', () => {
    it('evidence chain steps have citations (non-empty source)', async () => {
      const findings = await analyzeCascadeInteractions({
        medications: ['Fluconazole 200mg', 'Simvastatin 40mg'],
      });

      for (const finding of findings) {
        if (finding.chain && finding.chain.length > 0) {
          for (const step of finding.chain) {
            expect(step.source).toBeTruthy();
            expect(step.fact).toBeTruthy();
            expect(step.step).toBeGreaterThanOrEqual(1);
          }
        }
      }
    });

    it('findings include valid severity classification', async () => {
      const findings = await analyzeCascadeInteractions({
        medications: ['Fluconazole 200mg', 'Simvastatin 40mg', 'Warfarin 5mg'],
      });

      const validSeverities = ['CRITICAL', 'HIGH', 'MODERATE', 'LOW', 'INFO'];
      for (const finding of findings) {
        expect(validSeverities).toContain(finding.severity);
      }
    });
  });

  describe('with patient context (eGFR 28)', () => {
    it('amplifies severity when eGFR is 28', async () => {
      const mockPatientContext = {
        patient: { resourceType: 'Patient' as const, id: 'test-001', birthDate: '1947-01-01' },
        medications: [],
        observations: [],
        conditions: [],
        age: 78,
        egfr: 28,
      };

      const findings = await analyzeCascadeInteractions({
        medications: ['Fluconazole 200mg', 'Simvastatin 40mg'],
        patientContext: mockPatientContext,
      });

      expect(findings.length).toBeGreaterThanOrEqual(1);
      // With eGFR < 30 + strong inhibitor + major substrate = CRITICAL
      const topFinding = findings[0];
      expect(topFinding).toBeDefined();
      expect(topFinding!.severity).toBe('CRITICAL');
      // Verify the eGFR step is in the chain
      const egfrStep = topFinding!.chain?.find(s => s.fact.toLowerCase().includes('egfr'));
      expect(egfrStep).toBeDefined();
    });
  });
});
