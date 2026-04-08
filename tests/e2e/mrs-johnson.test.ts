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

let loadMrsJohnsonData: typeof import('../../data/synthea/mrs-johnson/index.js')['loadMrsJohnsonData'];
let analyzeCascadeInteractions: typeof import('../../src/mcp-server/tools/cascade-interactions.js')['analyzeCascadeInteractions'];
let checkOrganFunctionDosing: typeof import('../../src/mcp-server/tools/organ-function-dosing.js')['checkOrganFunctionDosing'];
let screenDeprescribing: typeof import('../../src/mcp-server/tools/deprescribing-screen.js')['screenDeprescribing'];
let runMedicationReview: typeof import('../../src/a2a-agent/orchestrator.js')['runMedicationReview'];

beforeAll(async () => {
  const dataModule = await import('../../data/synthea/mrs-johnson/index.js');
  loadMrsJohnsonData = dataModule.loadMrsJohnsonData;

  const cascadeModule = await import('../../src/mcp-server/tools/cascade-interactions.js');
  analyzeCascadeInteractions = cascadeModule.analyzeCascadeInteractions;

  const dosingModule = await import('../../src/mcp-server/tools/organ-function-dosing.js');
  checkOrganFunctionDosing = dosingModule.checkOrganFunctionDosing;

  const deprescModule = await import('../../src/mcp-server/tools/deprescribing-screen.js');
  screenDeprescribing = deprescModule.screenDeprescribing;

  const orchestratorModule = await import('../../src/a2a-agent/orchestrator.js');
  runMedicationReview = orchestratorModule.runMedicationReview;
});

describe('Mrs. Johnson E2E Pipeline', () => {
  let mrsJohnson: ReturnType<typeof loadMrsJohnsonData>;

  beforeAll(() => {
    mrsJohnson = loadMrsJohnsonData();
  });

  describe('data loading', () => {
    it('loads patient resource correctly', () => {
      expect(mrsJohnson.patient.resourceType).toBe('Patient');
      expect(mrsJohnson.patient.id).toBe('mrs-johnson-001');
      expect(mrsJohnson.patient.birthDate).toBe('1947-08-15');
    });

    it('loads all 12 medications', () => {
      expect(mrsJohnson.medications).toHaveLength(12);
    });

    it('has omeprazole with authoredOn 2024-10-01', () => {
      const omeprazole = mrsJohnson.medications.find(m =>
        m.medicationCodeableConcept?.coding?.some(c => c.code === '7646')
      );
      expect(omeprazole).toBeDefined();
      expect(omeprazole!.authoredOn).toBe('2024-10-01');
    });

    it('eGFR observation is 28', () => {
      const egfr = mrsJohnson.observations.find(o =>
        o.code?.coding?.some(c => c.code === '33914-3')
      );
      expect(egfr).toBeDefined();
      expect(egfr!.valueQuantity?.value).toBe(28);
    });

    it("has 5 conditions and NO GERD/Barrett's", () => {
      expect(mrsJohnson.conditions).toHaveLength(5);
      const gerd = mrsJohnson.conditions.find(c =>
        JSON.stringify(c).toLowerCase().includes('gerd') ||
        JSON.stringify(c).toLowerCase().includes('barrett') ||
        JSON.stringify(c).toLowerCase().includes('esophagitis')
      );
      expect(gerd).toBeUndefined();
    });
  });

  describe('cascade interaction analysis', () => {
    it('detects fluconazole-simvastatin CYP3A4 cascade', async () => {
      const medNames = mrsJohnson.medications.map(m =>
        m.medicationCodeableConcept?.coding?.[0]?.display ?? ''
      );

      const patientContext = {
        patient: mrsJohnson.patient,
        medications: mrsJohnson.medications,
        observations: mrsJohnson.observations,
        conditions: mrsJohnson.conditions,
        age: 78,
        egfr: 28,
        alt: 22,
        ast: 25,
        bilirubin: 0.8,
      };

      const findings = await analyzeCascadeInteractions({
        medications: medNames,
        patientContext,
      });

      expect(findings.length).toBeGreaterThanOrEqual(1);

      const cascade = findings.find(f =>
        (f.finding.toLowerCase().includes('simvastatin') || f.chain?.some(s => s.fact.toLowerCase().includes('simvastatin'))) &&
        (f.finding.toLowerCase().includes('fluconazole') || f.chain?.some(s => s.fact.toLowerCase().includes('fluconazole')))
      );
      expect(cascade).toBeDefined();
      expect(['CRITICAL', 'HIGH', 'MODERATE']).toContain(cascade!.severity);
    });
  });

  describe('organ-function dosing check', () => {
    it('flags metformin as contraindicated at eGFR 28', async () => {
      const medNames = mrsJohnson.medications.map(m =>
        m.medicationCodeableConcept?.coding?.[0]?.display ?? ''
      );

      const patientContext = {
        patient: mrsJohnson.patient,
        medications: mrsJohnson.medications,
        observations: mrsJohnson.observations,
        conditions: mrsJohnson.conditions,
        age: 78,
        egfr: 28,
      };

      const findings = await checkOrganFunctionDosing({
        medications: medNames,
        patientContext,
      });

      const metforminFinding = findings.find(f =>
        f.medication.toLowerCase().includes('metformin')
      );
      expect(metforminFinding).toBeDefined();
      expect(metforminFinding!.patientEgfr).toBe(28);
      expect(metforminFinding!.severity).toBe('CRITICAL');
    });

    it('flags gabapentin dose as excessive at eGFR 28', async () => {
      const medNames = mrsJohnson.medications.map(m =>
        m.medicationCodeableConcept?.coding?.[0]?.display ?? ''
      );

      const findings = await checkOrganFunctionDosing({
        medications: medNames,
        patientContext: {
          patient: mrsJohnson.patient,
          medications: mrsJohnson.medications,
          observations: mrsJohnson.observations,
          conditions: mrsJohnson.conditions,
          age: 78,
          egfr: 28,
        },
      });

      const gabapentinFinding = findings.find(f =>
        f.medication.toLowerCase().includes('gabapentin')
      );
      expect(gabapentinFinding).toBeDefined();
    });

    it('returns at least 2 dosing findings', async () => {
      const medNames = mrsJohnson.medications.map(m =>
        m.medicationCodeableConcept?.coding?.[0]?.display ?? ''
      );
      const findings = await checkOrganFunctionDosing({
        medications: medNames,
        patientContext: {
          patient: mrsJohnson.patient,
          medications: mrsJohnson.medications,
          observations: mrsJohnson.observations,
          conditions: mrsJohnson.conditions,
          age: 78,
          egfr: 28,
        },
      });

      const actionableFindings = findings.filter(f => f.severity !== 'INFO');
      expect(actionableFindings.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('deprescribing screening', () => {
    it('identifies omeprazole as deprescribing candidate', async () => {
      const findings = await screenDeprescribing({
        medications: mrsJohnson.medications,
        patientContext: {
          patient: mrsJohnson.patient,
          medications: mrsJohnson.medications,
          observations: mrsJohnson.observations,
          conditions: mrsJohnson.conditions,
          age: 78,
        },
        patientAge: 78,
      });

      const omeprazoleFinding = findings.find(f =>
        f.medication.toLowerCase().includes('omeprazole')
      );
      expect(omeprazoleFinding).toBeDefined();
    });

    it('omeprazole finding has a taper plan', async () => {
      const findings = await screenDeprescribing({
        medications: mrsJohnson.medications,
        patientContext: {
          patient: mrsJohnson.patient,
          medications: mrsJohnson.medications,
          observations: mrsJohnson.observations,
          conditions: mrsJohnson.conditions,
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
      }
    });
  });

  describe('full 5Ts orchestration', () => {
    it('produces complete MedReviewReport for Mrs. Johnson', async () => {
      const report = await runMedicationReview({
        patient: mrsJohnson.patient,
        medications: mrsJohnson.medications,
        observations: mrsJohnson.observations,
        conditions: mrsJohnson.conditions,
      });

      // Talk
      expect(report.talk).toBeTruthy();
      expect(report.talk.length).toBeGreaterThan(50);
      expect(report.talk.toLowerCase()).toContain('johnson');

      // Template (taper plans)
      expect(Array.isArray(report.template)).toBe(true);
      expect(report.template.length).toBeGreaterThanOrEqual(1);

      // Table (risk matrix - should have all 12 meds)
      expect(Array.isArray(report.table)).toBe(true);
      expect(report.table.length).toBe(12);

      // Task (pharmacy review items)
      expect(Array.isArray(report.task)).toBe(true);
    });
  });
});
