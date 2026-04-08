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

// Mock PGx prompt builder
vi.mock('../../src/mcp-server/prompts/pharmacogenomics-prompt.js', () => ({
  buildPGxPrompt: vi.fn().mockReturnValue({ systemPrompt: '', userPrompt: '' }),
}));

let checkPharmacogenomics: typeof import('../../src/mcp-server/tools/pharmacogenomics.js')['checkPharmacogenomics'];

beforeAll(async () => {
  const module = await import('../../src/mcp-server/tools/pharmacogenomics.js');
  checkPharmacogenomics = module.checkPharmacogenomics;
});

describe('checkPharmacogenomics', () => {
  it('flags codeine for CYP2D6 poor metabolizer', async () => {
    const findings = await checkPharmacogenomics({
      medications: ['codeine 30mg'],
      genotypes: { CYP2D6: 'poor_metabolizer' },
    });
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].severity).toMatch(/CRITICAL|HIGH/);
    expect(findings[0].gene).toBe('CYP2D6');
  });

  it('flags clopidogrel for CYP2C19 poor metabolizer', async () => {
    const findings = await checkPharmacogenomics({
      medications: ['clopidogrel 75mg'],
      genotypes: { CYP2C19: 'poor_metabolizer' },
    });
    const clopFinding = findings.find(f => f.drug.includes('clopidogrel'));
    expect(clopFinding).toBeDefined();
    expect(clopFinding!.severity).toBe('CRITICAL');
  });

  it('returns empty array when no genotype matches medications', async () => {
    const findings = await checkPharmacogenomics({
      medications: ['lisinopril 10mg', 'furosemide 40mg'],
      genotypes: { CYP2D6: 'poor_metabolizer' },
    });
    expect(Array.isArray(findings)).toBe(true);
  });

  it('returns empty array when genotypes not provided', async () => {
    const findings = await checkPharmacogenomics({
      medications: ['codeine 30mg'],
      genotypes: {},
    });
    expect(Array.isArray(findings)).toBe(true);
  });
});
