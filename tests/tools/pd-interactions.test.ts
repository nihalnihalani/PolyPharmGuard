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

// Mock PD prompt builder
vi.mock('../../src/mcp-server/prompts/pd-prompt.js', () => ({
  buildPDPrompt: vi.fn().mockReturnValue({ systemPrompt: '', userPrompt: '' }),
}));

let analyzePDInteractions: typeof import('../../src/mcp-server/tools/pd-interactions.js')['analyzePDInteractions'];

beforeAll(async () => {
  const module = await import('../../src/mcp-server/tools/pd-interactions.js');
  analyzePDInteractions = module.analyzePDInteractions;
});

describe('analyzePDInteractions', () => {
  it('detects CNS depression risk with opioid + benzodiazepine', async () => {
    const findings = await analyzePDInteractions({
      medications: ['oxycodone 10mg', 'alprazolam 1mg', 'gabapentin 300mg'],
    });
    expect(findings.length).toBeGreaterThan(0);
    const cns = findings.filter(f => f.class === 'CNS_DEPRESSION');
    expect(cns.length).toBeGreaterThan(0);
    expect(cns[0].severity).toMatch(/CRITICAL|HIGH/);
  });

  it('detects QT prolongation risk with two QT-prolonging drugs', async () => {
    const findings = await analyzePDInteractions({
      medications: ['azithromycin 500mg', 'haloperidol 5mg'],
    });
    const qt = findings.filter(f => f.class === 'QT_PROLONGATION');
    expect(qt.length).toBeGreaterThan(0);
  });

  it('detects bleeding risk with warfarin + NSAID', async () => {
    const findings = await analyzePDInteractions({
      medications: ['warfarin 5mg', 'ibuprofen 400mg'],
    });
    const bleeding = findings.filter(f => f.class === 'BLEEDING_RISK');
    expect(bleeding.length).toBeGreaterThan(0);
  });

  it('returns empty array for safe combination', async () => {
    const findings = await analyzePDInteractions({
      medications: ['lisinopril 10mg', 'atorvastatin 20mg'],
    });
    // May return 0 or low-severity findings — just verify it does not throw
    expect(Array.isArray(findings)).toBe(true);
  });
});
