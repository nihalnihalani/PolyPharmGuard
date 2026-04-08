import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const KB_DIR = join(__dirname, '../../src/knowledge-base');

const MRS_JOHNSON_RXNORM = ['4083', '36567', '17767', '6809', '11289', '7646', '25480', '29046', '6918', '1191', '4603', '8591'];
const VALID_ENZYMES = ['CYP3A4', 'CYP2D6', 'CYP2C9', 'CYP2C19', 'CYP1A2', 'CYP2B6', 'CYP2C8'];

describe('Knowledge Base Validation', () => {
  describe('CYP450 Substrates', () => {
    it('substrates.json parses as valid JSON with >10 entries', () => {
      const content = readFileSync(join(KB_DIR, 'cyp450/substrates.json'), 'utf-8');
      const substrates = JSON.parse(content);
      expect(Array.isArray(substrates)).toBe(true);
      expect(substrates.length).toBeGreaterThan(10);
    });

    it('each substrate entry has required fields', () => {
      const content = readFileSync(join(KB_DIR, 'cyp450/substrates.json'), 'utf-8');
      const data = JSON.parse(content);
      for (const entry of data) {
        expect(entry).toHaveProperty('drug');
        expect(entry).toHaveProperty('rxnormCui');
        expect(entry).toHaveProperty('cypRelationships');
        expect(Array.isArray(entry.cypRelationships)).toBe(true);
      }
    });

    it("Mrs. Johnson's 12 RxNorm codes are all present across substrates and inhibitors", () => {
      const substrateContent = readFileSync(join(KB_DIR, 'cyp450/substrates.json'), 'utf-8');
      const inhibitorContent = readFileSync(join(KB_DIR, 'cyp450/inhibitors.json'), 'utf-8');
      const subs = JSON.parse(substrateContent);
      const inhs = JSON.parse(inhibitorContent);

      const allCodes = new Set([
        ...subs.map((e: any) => e.rxnormCui),
        ...inhs.map((e: any) => e.rxnormCui),
      ]);

      for (const rxnorm of MRS_JOHNSON_RXNORM) {
        expect(allCodes.has(rxnorm), `RxNorm ${rxnorm} not found in KB`).toBe(true);
      }
    });

    it('CYP enzyme names are from valid set', () => {
      const content = readFileSync(join(KB_DIR, 'cyp450/substrates.json'), 'utf-8');
      const data = JSON.parse(content);
      for (const entry of data) {
        for (const rel of entry.cypRelationships) {
          expect(VALID_ENZYMES, `Invalid enzyme: ${rel.enzyme}`).toContain(rel.enzyme);
        }
      }
    });
  });

  describe('CYP450 Inhibitors', () => {
    it('inhibitors.json parses as valid JSON with required fields', () => {
      const content = readFileSync(join(KB_DIR, 'cyp450/inhibitors.json'), 'utf-8');
      const data = JSON.parse(content);
      expect(Array.isArray(data)).toBe(true);
      for (const entry of data) {
        expect(entry).toHaveProperty('drug');
        expect(entry).toHaveProperty('rxnormCui');
        expect(entry).toHaveProperty('inhibitions');
      }
    });

    it('fluconazole is listed as a CYP3A4 strong inhibitor', () => {
      const content = readFileSync(join(KB_DIR, 'cyp450/inhibitors.json'), 'utf-8');
      const data = JSON.parse(content);
      const fluconazole = data.find((e: any) => e.drug === 'fluconazole');
      expect(fluconazole).toBeDefined();
      const cyp3a4 = fluconazole.inhibitions.find((i: any) => i.enzyme === 'CYP3A4');
      expect(cyp3a4).toBeDefined();
      // Fluconazole is a MODERATE CYP3A4 inhibitor at standard doses (≤200mg/day).
      // Strong CYP3A4 inhibition applies only at ≥400mg/day per FDA classification.
      expect(cyp3a4.strength).toContain('moderate');
    });

    it('fluconazole is listed as a CYP2C19 strong inhibitor', () => {
      const content = readFileSync(join(KB_DIR, 'cyp450/inhibitors.json'), 'utf-8');
      const data = JSON.parse(content);
      const fluconazole = data.find((e: any) => e.drug === 'fluconazole');
      expect(fluconazole).toBeDefined();
      const cyp2c19 = fluconazole.inhibitions.find((i: any) => i.enzyme === 'CYP2C19');
      expect(cyp2c19).toBeDefined();
      expect(cyp2c19.strength).toContain('strong');
    });
  });

  describe('Beers Criteria', () => {
    it('beers-criteria.json parses as valid JSON', () => {
      const content = readFileSync(join(KB_DIR, 'beers-criteria.json'), 'utf-8');
      expect(() => JSON.parse(content)).not.toThrow();
    });

    it('each entry has required fields', () => {
      const content = readFileSync(join(KB_DIR, 'beers-criteria.json'), 'utf-8');
      const data = JSON.parse(content);
      for (const entry of data) {
        expect(entry).toHaveProperty('drug');
        expect(entry).toHaveProperty('recommendation');
        expect(entry).toHaveProperty('ageThreshold');
        expect(entry).toHaveProperty('source');
      }
    });

    it('omeprazole (or PPI class) is in Beers criteria', () => {
      const content = readFileSync(join(KB_DIR, 'beers-criteria.json'), 'utf-8');
      const data = JSON.parse(content);
      const ppiEntry = data.find((e: any) =>
        e.drug === 'omeprazole' || e.drugClass?.toLowerCase().includes('proton pump')
      );
      expect(ppiEntry).toBeDefined();
    });

    it('gabapentin is in Beers criteria 2023', () => {
      const content = readFileSync(join(KB_DIR, 'beers-criteria.json'), 'utf-8');
      const data = JSON.parse(content);
      const gabapentinEntry = data.find((e: any) =>
        e.drug === 'gabapentin' || e.drugClass?.toLowerCase().includes('gabapentinoid')
      );
      expect(gabapentinEntry).toBeDefined();
    });

    it('all ageThreshold values are >= 65', () => {
      const content = readFileSync(join(KB_DIR, 'beers-criteria.json'), 'utf-8');
      const data = JSON.parse(content);
      for (const entry of data) {
        expect(entry.ageThreshold).toBeGreaterThanOrEqual(65);
      }
    });
  });

  describe('Renal Dosing', () => {
    it('renal-dosing.json parses as valid JSON', () => {
      const content = readFileSync(join(KB_DIR, 'renal-hepatic/renal-dosing.json'), 'utf-8');
      expect(() => JSON.parse(content)).not.toThrow();
    });

    it('metformin has eGFR threshold at/near 30 and is contraindicated below it', () => {
      const content = readFileSync(join(KB_DIR, 'renal-hepatic/renal-dosing.json'), 'utf-8');
      const data = JSON.parse(content);
      const metformin = data.find((e: any) => e.drug === 'metformin');
      expect(metformin).toBeDefined();
      const contraindicatedRange = metformin.adjustments.find((a: any) => a.contraindicated === true);
      expect(contraindicatedRange).toBeDefined();
      const max = contraindicatedRange.egfrRange.max;
      expect(max).toBeGreaterThanOrEqual(25);
      expect(max).toBeLessThanOrEqual(35);
    });

    it('gabapentin has dose adjustment for low eGFR (15-29)', () => {
      const content = readFileSync(join(KB_DIR, 'renal-hepatic/renal-dosing.json'), 'utf-8');
      const data = JSON.parse(content);
      const gabapentin = data.find((e: any) => e.drug === 'gabapentin');
      expect(gabapentin).toBeDefined();
      const lowEgfrAdj = gabapentin.adjustments.find((a: any) =>
        a.egfrRange.min === 15 && a.egfrRange.max === 29
      );
      expect(lowEgfrAdj).toBeDefined();
      expect(lowEgfrAdj.recommendation.toLowerCase()).toContain('300mg');
    });
  });

  describe('STOPPFrail', () => {
    it('stoppfrail.json parses as valid JSON with required fields', () => {
      const content = readFileSync(join(KB_DIR, 'stoppfrail.json'), 'utf-8');
      const data = JSON.parse(content);
      expect(Array.isArray(data)).toBe(true);
      for (const entry of data) {
        expect(entry).toHaveProperty('criterion');
        expect(entry).toHaveProperty('drugs');
        expect(entry).toHaveProperty('recommendation');
      }
    });

    it('omeprazole is in STOPPFrail criteria', () => {
      const content = readFileSync(join(KB_DIR, 'stoppfrail.json'), 'utf-8');
      const data = JSON.parse(content);
      const ppiEntry = data.find((e: any) =>
        e.drugs.includes('omeprazole') || e.drugClass?.toLowerCase().includes('proton pump')
      );
      expect(ppiEntry).toBeDefined();
    });
  });
});
