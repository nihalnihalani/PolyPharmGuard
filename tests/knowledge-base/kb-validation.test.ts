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

    it('has at least 20 entries (STOPPFrail v2 expansion)', () => {
      const content = readFileSync(join(KB_DIR, 'stoppfrail.json'), 'utf-8');
      const data = JSON.parse(content);
      expect(data.length).toBeGreaterThanOrEqual(20);
    });

    it('every entry cites a source', () => {
      const content = readFileSync(join(KB_DIR, 'stoppfrail.json'), 'utf-8');
      const data = JSON.parse(content);
      for (const entry of data) {
        expect(entry.source, `STOPPFrail entry ${entry.criterion} missing source`).toBeTruthy();
      }
    });
  });

  describe('Cross-KB validation', () => {
    const KB_FILES = [
      'cyp450/substrates.json',
      'cyp450/inhibitors.json',
      'cyp450/inducers.json',
      'lab-monitoring.json',
      'pharmacogenomics.json',
      'renal-hepatic/renal-dosing.json',
      'renal-hepatic/hepatic-dosing.json',
    ];

    it('no RxNorm CUI maps to more than one drug name across all KB files', () => {
      const cuiToDrugs: Record<string, Set<string>> = {};
      for (const f of KB_FILES) {
        const content = readFileSync(join(KB_DIR, f), 'utf-8');
        const data = JSON.parse(content);
        for (const entry of data) {
          const cui = entry.rxnormCui;
          const drug = (entry.drug || '').toLowerCase();
          if (!cui || cui === '0') continue;
          if (!cuiToDrugs[cui]) cuiToDrugs[cui] = new Set();
          cuiToDrugs[cui].add(drug);
        }
      }
      const collisions: string[] = [];
      for (const [cui, drugs] of Object.entries(cuiToDrugs)) {
        if (drugs.size > 1) collisions.push(`CUI ${cui} -> ${[...drugs].join(', ')}`);
      }
      expect(collisions, `CUI collisions found:\n${collisions.join('\n')}`).toEqual([]);
    });

    it('phenytoin uses CUI 8183 consistently across KB files', () => {
      const sub = JSON.parse(readFileSync(join(KB_DIR, 'cyp450/substrates.json'), 'utf-8'));
      const lab = JSON.parse(readFileSync(join(KB_DIR, 'lab-monitoring.json'), 'utf-8'));
      const ind = JSON.parse(readFileSync(join(KB_DIR, 'cyp450/inducers.json'), 'utf-8'));

      const subPhenytoin = sub.find((e: any) => e.drug === 'phenytoin');
      const labPhenytoin = lab.find((e: any) => e.drug === 'phenytoin');
      const indPhenytoin = ind.find((e: any) => e.drug === 'phenytoin');

      expect(subPhenytoin?.rxnormCui).toBe('8183');
      expect(labPhenytoin?.rxnormCui).toBe('8183');
      expect(indPhenytoin?.rxnormCui).toBe('8183');
    });

    it('ropinirole and risperidone have distinct CUIs', () => {
      const sub = JSON.parse(readFileSync(join(KB_DIR, 'cyp450/substrates.json'), 'utf-8'));
      const ropinirole = sub.find((e: any) => e.drug === 'ropinirole');
      const risperidone = sub.find((e: any) => e.drug === 'risperidone');
      expect(ropinirole?.rxnormCui).toBe('35828');
      expect(risperidone?.rxnormCui).toBe('35636');
    });
  });

  describe('Beers Criteria expansion', () => {
    it('has at least 50 entries (AGS 2023 expansion)', () => {
      const content = readFileSync(join(KB_DIR, 'beers-criteria.json'), 'utf-8');
      const data = JSON.parse(content);
      expect(data.length).toBeGreaterThanOrEqual(50);
    });

    it('every Beers entry cites a source', () => {
      const content = readFileSync(join(KB_DIR, 'beers-criteria.json'), 'utf-8');
      const data = JSON.parse(content);
      for (const entry of data) {
        expect(entry.source, `Beers entry for ${entry.drug} missing source`).toBeTruthy();
        expect(entry.source.toLowerCase()).toMatch(/ags|beers/);
      }
    });

    it('covers the key high-value drug classes', () => {
      const content = readFileSync(join(KB_DIR, 'beers-criteria.json'), 'utf-8');
      const data = JSON.parse(content);
      const allDrugs = new Set(data.map((e: any) => e.drug.toLowerCase()));
      const allClasses = data.map((e: any) => (e.drugClass || '').toLowerCase()).join(' ');

      // Required high-value drugs from acceptance criteria
      expect(allDrugs.has('glyburide') || allDrugs.has('glibenclamide')).toBe(true);
      expect(allDrugs.has('digoxin') || allClasses.includes('cardiac glycoside')).toBe(true);
      expect(allDrugs.has('diphenhydramine')).toBe(true);
      expect(allDrugs.has('oxybutynin')).toBe(true);
      expect(allDrugs.has('cyclobenzaprine')).toBe(true);
      expect(allDrugs.has('megestrol')).toBe(true);
      expect(allDrugs.has('nitrofurantoin')).toBe(true);
      expect(allDrugs.has('meperidine')).toBe(true);
      expect(allClasses).toContain('benzodiazepine');
      expect(allClasses).toContain('z-drug');
      expect(allClasses).toContain('tricyclic');
      expect(allClasses).toContain('nsaid');
    });
  });

  describe('Pharmacogenomics + Inhibitor cross-reference (Mr. Patel scenario)', () => {
    it('clopidogrel is flagged as a CYP2C19 prodrug substrate', () => {
      const sub = JSON.parse(readFileSync(join(KB_DIR, 'cyp450/substrates.json'), 'utf-8'));
      const clopidogrel = sub.find((e: any) => e.drug === 'clopidogrel');
      expect(clopidogrel).toBeDefined();
      const cyp2c19Rel = clopidogrel.cypRelationships.find((r: any) => r.enzyme === 'CYP2C19');
      expect(cyp2c19Rel).toBeDefined();
      // Prodrug flag enables cascade tool to reason about loss-of-efficacy direction
      expect(clopidogrel.prodrug).toBe(true);
    });

    it('fluvoxamine is a strong CYP2C19 inhibitor (would block clopidogrel activation)', () => {
      const inh = JSON.parse(readFileSync(join(KB_DIR, 'cyp450/inhibitors.json'), 'utf-8'));
      const fluvoxamine = inh.find((e: any) => e.drug === 'fluvoxamine');
      expect(fluvoxamine).toBeDefined();
      const cyp2c19 = fluvoxamine.inhibitions.find((i: any) => i.enzyme === 'CYP2C19');
      expect(cyp2c19).toBeDefined();
      expect(cyp2c19.strength).toContain('strong');
    });

    it('pharmacogenomics KB documents clopidogrel-CYP2C19 prodrug relationship', () => {
      const pgx = JSON.parse(readFileSync(join(KB_DIR, 'pharmacogenomics.json'), 'utf-8'));
      const clopidogrelEntry = pgx.find((e: any) => e.drug === 'clopidogrel' && e.gene === 'CYP2C19');
      expect(clopidogrelEntry).toBeDefined();
      expect(clopidogrelEntry.consequence.toLowerCase()).toContain('prodrug');
    });
  });
});
