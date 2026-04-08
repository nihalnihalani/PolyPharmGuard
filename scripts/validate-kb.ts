#!/usr/bin/env tsx
/**
 * validate-kb.ts — Validates all local knowledge base JSON files for clinical integrity.
 * Run: npm run validate:kb
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KB_DIR = join(__dirname, '../src/knowledge-base');

let errors = 0;
let warnings = 0;

function check(condition: boolean, message: string, critical = false): void {
  if (!condition) {
    if (critical) {
      console.error(`  ✗ CRITICAL: ${message}`);
      errors++;
    } else {
      console.warn(`  ⚠ WARNING:  ${message}`);
      warnings++;
    }
  } else {
    console.log(`  ✓ ${message}`);
  }
}

function loadJSON<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

// Mrs. Johnson's 12 RxNorm CUIs
const MRS_JOHNSON_RXNORM = ['4083', '36567', '17767', '6809', '11289', '7646', '25480', '29046', '6918', '1191', '4603', '8591'];
const VALID_CYP_ENZYMES = new Set(['CYP3A4', 'CYP2D6', 'CYP2C9', 'CYP2C19', 'CYP1A2', 'CYP2B6', 'CYP2C8']);

// ── CYP450 Substrates ──────────────────────────────────────────────────────────
console.log('\n── CYP450 Substrates ───────────────────────────────────────────');
const substrates: any[] = loadJSON(join(KB_DIR, 'cyp450/substrates.json'));
check(Array.isArray(substrates) && substrates.length > 10, `substrates.json: ${substrates.length} entries (expected >10)`, true);
check(substrates.every(e => e.drug && e.rxnormCui && Array.isArray(e.cypRelationships)), 'all substrate entries have required fields (drug, rxnormCui, cypRelationships)', true);
const substrateCuis = new Set(substrates.map(e => e.rxnormCui));

// ── CYP450 Inhibitors ──────────────────────────────────────────────────────────
console.log('\n── CYP450 Inhibitors ───────────────────────────────────────────');
const inhibitors: any[] = loadJSON(join(KB_DIR, 'cyp450/inhibitors.json'));
check(Array.isArray(inhibitors) && inhibitors.length > 5, `inhibitors.json: ${inhibitors.length} entries`, true);
check(inhibitors.every(e => e.drug && e.rxnormCui && Array.isArray(e.inhibitions)), 'all inhibitor entries have required fields', true);
const inhibitorCuis = new Set(inhibitors.map(e => e.rxnormCui));

const fluconazole = inhibitors.find(e => e.drug === 'fluconazole');
check(fluconazole !== undefined, 'fluconazole is in inhibitors.json', true);
if (fluconazole) {
  const cyp3a4 = fluconazole.inhibitions?.find((i: any) => i.enzyme === 'CYP3A4');
  check(cyp3a4 !== undefined, 'fluconazole has CYP3A4 inhibition entry', true);
  check(cyp3a4?.strength?.includes('strong'), `fluconazole CYP3A4 strength = "${cyp3a4?.strength}" (expected strong)`, true);
  const cyp2c19 = fluconazole.inhibitions?.find((i: any) => i.enzyme === 'CYP2C19');
  check(cyp2c19 !== undefined, 'fluconazole has CYP2C19 inhibition entry', true);
  check(cyp2c19?.strength?.includes('strong'), `fluconazole CYP2C19 strength = "${cyp2c19?.strength}" (expected strong)`, true);
  const cyp2c9 = fluconazole.inhibitions?.find((i: any) => i.enzyme === 'CYP2C9');
  check(cyp2c9 !== undefined, 'fluconazole has CYP2C9 inhibition entry', true);
}

// ── Mrs. Johnson's 12-drug coverage ───────────────────────────────────────────
console.log('\n── Mrs. Johnson 12-Drug Coverage ───────────────────────────────');
const allCuis = new Set([...substrateCuis, ...inhibitorCuis]);
for (const cui of MRS_JOHNSON_RXNORM) {
  check(allCuis.has(cui), `RxNorm ${cui} present in substrates or inhibitors`, true);
}

// ── Enzyme name validity ───────────────────────────────────────────────────────
console.log('\n── CYP Enzyme Name Validation ──────────────────────────────────');
const allSubstrateEnzymes = substrates.flatMap(e => e.cypRelationships.map((r: any) => r.enzyme));
const invalidEnzymes = allSubstrateEnzymes.filter(e => !VALID_CYP_ENZYMES.has(e));
check(invalidEnzymes.length === 0, `all CYP enzyme names valid (found: ${[...new Set(allSubstrateEnzymes)].join(', ')})`, true);

// ── Beers Criteria ─────────────────────────────────────────────────────────────
console.log('\n── Beers Criteria 2023 ─────────────────────────────────────────');
const beers: any[] = loadJSON(join(KB_DIR, 'beers-criteria.json'));
check(Array.isArray(beers) && beers.length > 5, `beers-criteria.json: ${beers.length} entries`, true);
check(beers.every(e => e.drug && e.recommendation && e.source), 'all Beers entries have required fields', true);
const beersDrugs = beers.map(e => (e.drug as string).toLowerCase());
const hasPPI = beersDrugs.some(d => d.includes('ppi') || d.includes('omeprazole') || d.includes('proton'));
check(hasPPI, 'Beers criteria includes PPI/omeprazole entry', true);
const hasGabapentin = beersDrugs.some(d => d.includes('gabapentin') || d.includes('gabapentinoid'));
check(hasGabapentin, 'Beers criteria includes gabapentin/gabapentinoids (2023 update)', true);
const allAgeThresholds = beers.filter(e => e.ageThreshold != null).map(e => e.ageThreshold);
check(allAgeThresholds.every(a => a >= 65), `all Beers ageThreshold values >= 65 (found: ${allAgeThresholds.join(', ')})`, true);

// ── STOPPFrail ─────────────────────────────────────────────────────────────────
console.log('\n── STOPPFrail Criteria ─────────────────────────────────────────');
const stoppfrail: any[] = loadJSON(join(KB_DIR, 'stoppfrail.json'));
check(Array.isArray(stoppfrail) && stoppfrail.length > 3, `stoppfrail.json: ${stoppfrail.length} entries`, true);
check(stoppfrail.every(e => (e.id || e.criterion) && e.recommendation && e.source), 'all STOPPFrail entries have required fields (criterion/id, recommendation, source)', true);
const stoppDrugs = stoppfrail.map(e => JSON.stringify(e).toLowerCase());
const stoppHasPPI = stoppDrugs.some(e => e.includes('ppi') || e.includes('omeprazole') || e.includes('proton'));
check(stoppHasPPI, 'STOPPFrail includes PPI/omeprazole criterion', true);

// ── Renal Dosing ───────────────────────────────────────────────────────────────
console.log('\n── Renal Dosing Tables ─────────────────────────────────────────');
const renalDosing: any[] = loadJSON(join(KB_DIR, 'renal-hepatic/renal-dosing.json'));
check(Array.isArray(renalDosing) && renalDosing.length > 5, `renal-dosing.json: ${renalDosing.length} entries`, true);
const metformin = renalDosing.find(e => e.drug === 'metformin');
check(metformin !== undefined, 'metformin is in renal-dosing.json', true);
if (metformin) {
  const contraindicatedEntry = metformin.adjustments?.find((a: any) => a.contraindicated === true);
  const hasEgfr30Threshold = metformin.adjustments?.some((a: any) => a.egfrRange?.max <= 30);
  check(contraindicatedEntry !== undefined || hasEgfr30Threshold, 'metformin has contraindicated flag or eGFR<=30 threshold', true);
}
const gabapentin = renalDosing.find(e => e.drug === 'gabapentin');
check(gabapentin !== undefined, 'gabapentin is in renal-dosing.json', true);
if (gabapentin) {
  const lowEgfr = gabapentin.adjustments?.find((a: any) => a.egfrRange?.min >= 15 && a.egfrRange?.max <= 30);
  check(lowEgfr !== undefined, 'gabapentin has dose adjustment entry for eGFR 15-29', true);
}

// ── Hepatic Dosing ─────────────────────────────────────────────────────────────
console.log('\n── Hepatic Dosing Tables ───────────────────────────────────────');
const hepaticDosing: any[] = loadJSON(join(KB_DIR, 'renal-hepatic/hepatic-dosing.json'));
check(Array.isArray(hepaticDosing) && hepaticDosing.length > 2, `hepatic-dosing.json: ${hepaticDosing.length} entries`, true);

// ── Final Summary ──────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(60));
if (errors === 0 && warnings === 0) {
  console.log('✅ Knowledge base validation PASSED — all checks clean');
} else if (errors === 0) {
  console.log(`⚠️  Knowledge base validation PASSED with ${warnings} warning(s)`);
} else {
  console.error(`❌ Knowledge base validation FAILED — ${errors} critical error(s), ${warnings} warning(s)`);
  process.exit(1);
}
