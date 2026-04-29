/**
 * Mr. Raj Patel E2E — the "AI Factor" case.
 *
 * Mr. Patel is a 62yo male whose medication list contains a 3-step CYP cascade
 * that pairwise drug interaction checkers (Lexicomp, Micromedex) miss:
 *
 *   1. Fluvoxamine (strong CYP2C19 inhibitor) + Clopidogrel (CYP2C19-activated
 *      prodrug) → reduced active metabolite → increased stent thrombosis risk
 *      in a post-DES patient. **This pair is NOT on standard pairwise alert
 *      lists.**
 *   2. Fluvoxamine (moderate CYP3A4) + residual ritonavir (strong CYP3A4) +
 *      Atorvastatin (major CYP3A4 substrate) → compound CYP3A4 inhibition →
 *      atorvastatin AUC spike → rhabdomyolysis risk window.
 *   3. Fluvoxamine (strong CYP1A2) + Tizanidine (major CYP1A2 substrate, NTI)
 *      → severe hypotension/bradycardia. The classic pairwise-detected miss
 *      that emphasizes the cascade engine's depth.
 *
 * These tests assert detection of #1 and #3 against the local algorithmic
 * cascade engine. #2 is asserted in degraded form — see notes below — because
 * the canonical "Paxlovid completed 7 days ago" residual-effect logic requires
 * KB expansion to encode mechanism-based inhibitor decay (Agent 5 lane).
 */

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

vi.mock('../../src/mcp-server/prompts/cascade-prompt.js', () => ({
  buildCascadePrompt: vi.fn().mockReturnValue({ systemPrompt: '', userPrompt: '' }),
}));

vi.mock('../../src/mcp-server/prompts/dosing-prompt.js', () => ({
  buildDosingPrompt: vi.fn().mockReturnValue({ systemPrompt: '', userPrompt: '' }),
}));

vi.mock('../../src/mcp-server/prompts/deprescribing-prompt.js', () => ({
  buildDeprescribingPrompt: vi.fn().mockReturnValue({ systemPrompt: '', userPrompt: '' }),
}));

let loadMrPatelData: typeof import('../../data/synthea/mr-patel/index.js')['loadMrPatelData'];
let analyzeCascadeInteractions: typeof import('../../src/mcp-server/tools/cascade-interactions.js')['analyzeCascadeInteractions'];

beforeAll(async () => {
  const dataModule = await import('../../data/synthea/mr-patel/index.js');
  loadMrPatelData = dataModule.loadMrPatelData;

  const cascadeModule = await import('../../src/mcp-server/tools/cascade-interactions.js');
  analyzeCascadeInteractions = cascadeModule.analyzeCascadeInteractions;
});

describe('Mr. Raj Patel — AI Factor cascade case', () => {
  let patel: ReturnType<typeof loadMrPatelData>;

  beforeAll(() => {
    patel = loadMrPatelData();
  });

  describe('FHIR data integrity', () => {
    it('Patient resource is well-formed and synthetic', () => {
      expect(patel.patient.resourceType).toBe('Patient');
      expect(patel.patient.id).toBe('mr-patel-001');
      expect(patel.patient.name?.[0]?.family).toBe('Patel');
      expect(patel.patient.name?.[0]?.given?.[0]).toBe('Raj');
      // Synthetic identifier — no real MRN
      expect(patel.patient.identifier?.[0]?.value).toMatch(/^MRN-PATEL-/);
    });

    it('has 8 medications including fluvoxamine, tizanidine, clopidogrel, Paxlovid, atorvastatin', () => {
      expect(patel.medications.length).toBe(8);
      const drugs = patel.medications
        .map((m) => m.medicationCodeableConcept?.coding?.[0]?.display?.toLowerCase() ?? '')
        .join('|');
      expect(drugs).toContain('fluvoxamine');
      expect(drugs).toContain('tizanidine');
      expect(drugs).toContain('clopidogrel');
      expect(drugs).toContain('atorvastatin');
      expect(drugs).toContain('nirmatrelvir');
    });

    it('Paxlovid is marked completed (residual ritonavir window)', () => {
      const paxlovid = patel.medications.find((m) =>
        m.medicationCodeableConcept?.coding?.[0]?.display?.toLowerCase().includes('nirmatrelvir')
      );
      expect(paxlovid).toBeDefined();
      expect(paxlovid!.status).toBe('completed');
    });

    it('eGFR is normal (78) — not a renal case', () => {
      const egfr = patel.observations.find((o) =>
        o.code?.coding?.some((c) => c.code === '33914-3')
      );
      expect(egfr?.valueQuantity?.value).toBe(78);
    });

    it('has post-DES condition (drug-eluting stent) — high-stakes context', () => {
      const des = patel.conditions.find((c) =>
        JSON.stringify(c).toLowerCase().includes('stent')
      );
      expect(des).toBeDefined();
    });
  });

  describe('cascade detection — the AI Factor moment', () => {
    function activeMedNames(): string[] {
      // Active meds plus Paxlovid (residual ritonavir effect within ~3-4 days)
      return patel.medications
        .filter((m) => m.status === 'active' || m.status === 'completed')
        .map((m) => m.medicationCodeableConcept?.coding?.[0]?.display ?? '')
        .filter((s) => s.length > 0);
    }

    it('FINDING #1 (hero): detects fluvoxamine→clopidogrel CYP2C19 cascade (post-DES stent thrombosis risk)', async () => {
      const meds = activeMedNames();
      const findings = await analyzeCascadeInteractions({
        medications: meds,
        patientContext: {
          patient: patel.patient,
          medications: patel.medications,
          observations: patel.observations,
          conditions: patel.conditions,
          age: 62,
          egfr: 78,
        },
      });

      const cascade = findings.find((f) => {
        const blob = (f.finding + ' ' + (f.chain ?? []).map((s) => s.fact).join(' ')).toLowerCase();
        return blob.includes('fluvoxamine') && blob.includes('clopidogrel') && blob.includes('cyp2c19');
      });

      expect(cascade).toBeDefined();
      // Evidence chain MUST cite both halves with sources (no LLM hallucination)
      expect(cascade!.chain.length).toBeGreaterThanOrEqual(2);
      expect(cascade!.chain.every((step) => step.source && step.source.length > 0)).toBe(true);
      // Severity should be at least HIGH — strong inhibitor + major substrate
      expect(['CRITICAL', 'HIGH']).toContain(cascade!.severity);

      // Clinical direction MUST be loss-of-efficacy, NOT toxicity (clopidogrel is a
      // prodrug — CYP2C19 inhibition reduces active metabolite formation, not raises
      // plasma levels). Anyone re-introducing the inversion will trip this assertion.
      const text = `${cascade!.finding} ${cascade!.clinicalConsequence} ${cascade!.recommendation}`.toLowerCase();
      expect(text).toMatch(/reduced|antiplatelet|stent thrombosis|loss of efficacy|under.?activation/);
      expect(text).not.toMatch(/reduce clopidogrel dose|clopidogrel toxicity/);
    });

    it('FINDING #3: detects fluvoxamine→tizanidine CYP1A2 cascade (severe hypotension)', async () => {
      const meds = activeMedNames();
      const findings = await analyzeCascadeInteractions({
        medications: meds,
        patientContext: {
          patient: patel.patient,
          medications: patel.medications,
          observations: patel.observations,
          conditions: patel.conditions,
          age: 62,
          egfr: 78,
        },
      });

      const cascade = findings.find((f) => {
        const blob = (f.finding + ' ' + (f.chain ?? []).map((s) => s.fact).join(' ')).toLowerCase();
        return blob.includes('fluvoxamine') && blob.includes('tizanidine') && blob.includes('cyp1a2');
      });

      expect(cascade).toBeDefined();
      expect(['CRITICAL', 'HIGH']).toContain(cascade!.severity);
    });

    it('FINDING #2 (degraded): detects fluvoxamine→atorvastatin CYP3A4 cascade', async () => {
      // NOTE: Full finding #2 is the COMPOUND inhibition — fluvoxamine + residual
      // ritonavir → atorvastatin spike. The current KB models inhibitors as static
      // (no decay model for mechanism-based inhibitors post-discontinuation), so
      // we assert the conservative single-inhibitor finding here. Compound-inhibitor
      // synthesis with residual-effect modeling is a KB expansion item (Agent 5).
      const meds = activeMedNames();
      const findings = await analyzeCascadeInteractions({
        medications: meds,
        patientContext: {
          patient: patel.patient,
          medications: patel.medications,
          observations: patel.observations,
          conditions: patel.conditions,
          age: 62,
          egfr: 78,
        },
      });

      const cascade = findings.find((f) => {
        const blob = (f.finding + ' ' + (f.chain ?? []).map((s) => s.fact).join(' ')).toLowerCase();
        return (blob.includes('ritonavir') || blob.includes('fluvoxamine')) && blob.includes('atorvastatin');
      });

      expect(cascade).toBeDefined();
    });

    it('returns at least 3 actionable cascade findings (not just one)', async () => {
      const meds = activeMedNames();
      const findings = await analyzeCascadeInteractions({
        medications: meds,
        patientContext: {
          patient: patel.patient,
          medications: patel.medications,
          observations: patel.observations,
          conditions: patel.conditions,
          age: 62,
          egfr: 78,
        },
      });

      const actionable = findings.filter(
        (f) => f.severity === 'CRITICAL' || f.severity === 'HIGH' || f.severity === 'MODERATE'
      );
      expect(actionable.length).toBeGreaterThanOrEqual(3);
    });
  });
});
