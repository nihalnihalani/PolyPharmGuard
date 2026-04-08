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

// Mock lab monitoring prompt builder
vi.mock('../../src/mcp-server/prompts/lab-monitoring-prompt.js', () => ({
  buildLabMonitoringPrompt: vi.fn().mockReturnValue({ systemPrompt: '', userPrompt: '' }),
}));

let checkLabMonitoring: typeof import('../../src/mcp-server/tools/lab-monitoring.js')['checkLabMonitoring'];

beforeAll(async () => {
  const module = await import('../../src/mcp-server/tools/lab-monitoring.js');
  checkLabMonitoring = module.checkLabMonitoring;
});

describe('checkLabMonitoring', () => {
  it('flags warfarin with no recent INR', async () => {
    const findings = await checkLabMonitoring({
      medications: ['warfarin 5mg daily'],
      recentLabs: [],
    });
    const inrFlag = findings.find(f => f.labName.includes('INR') || f.drug.includes('warfarin'));
    expect(inrFlag).toBeDefined();
    expect(inrFlag!.status).toMatch(/MISSING|OVERDUE/);
  });

  it('flags digoxin with no recent level check', async () => {
    const findings = await checkLabMonitoring({
      medications: ['digoxin 0.125mg daily'],
      recentLabs: [],
    });
    const digFlag = findings.find(f => f.drug.includes('digoxin'));
    expect(digFlag).toBeDefined();
  });

  it('marks warfarin as CURRENT when recent INR exists within 30 days', async () => {
    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - 10);
    const findings = await checkLabMonitoring({
      medications: ['warfarin 5mg daily'],
      recentLabs: [{
        loincCode: '6301-6',
        value: 2.5,
        date: recentDate.toISOString().split('T')[0],
        labName: 'INR',
      }],
    });
    const inrFlag = findings.find(f => f.labName.includes('INR') || f.drug.includes('warfarin'));
    if (inrFlag) {
      expect(inrFlag.status).toBe('CURRENT');
    }
    // Either not flagged (good) or flagged as CURRENT
    expect(true).toBe(true);
  });

  it('flags out-of-range digoxin level', async () => {
    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - 5);
    const findings = await checkLabMonitoring({
      medications: ['digoxin 0.125mg daily'],
      recentLabs: [{
        loincCode: '10535-3',
        value: 2.5, // above 2.0 ng/mL critical threshold
        date: recentDate.toISOString().split('T')[0],
        labName: 'Digoxin level',
      }],
    });
    const digFlag = findings.find(f => f.status === 'OUT_OF_RANGE');
    expect(digFlag).toBeDefined();
    expect(digFlag!.severity).toMatch(/CRITICAL|HIGH/);
  });
});
