/**
 * Pharmacogenomic phenotype ingestion from FHIR Observations.
 *
 * Reads FHIR R4 Observations whose .code.coding[].code matches a known
 * CPIC/PharmGKB phenotype LOINC, and maps them to the gene → phenotype
 * record that the pharmacogenomics MCP tool consumes (CYPPhenotype).
 *
 * Phenotype values come from the Observation's
 *   .valueCodeableConcept.text  (preferred — clinician-curated free text)
 * OR
 *   .valueCodeableConcept.coding[].display
 * OR
 *   .valueString
 *
 * We accept loose text matching ("ultra-rapid", "ultra rapid", "UM") because
 * lab vendors disagree on canonical strings. Unknown phenotype text is
 * dropped (no fabrication).
 *
 * If the FHIR server has no PGx Observations, callers should fall back to
 * any clinician-entered `genotypes` field on the review request — that's
 * a non-FHIR escape hatch for prototypes / clinician-entered structured
 * input via a frontend form.
 */

import type { CYPPhenotype } from '../types/clinical.js';
import type { FHIRObservation } from '../types/fhir.js';
import type { FHIRClient } from './client.js';

// Subset of CPIC/PharmGKB pgx LOINC codes we recognise. Extend as more
// genes are needed — covers the common CPIC-actionable enzymes today.
const PGX_LOINC_TO_GENE: Record<string, string> = {
  '54091-9': 'CYP2D6',
  '79716-7': 'CYP2C19',
  '81244-7': 'CYP2C9',
  // Additional CPIC codes (less commonly populated) — harmless to include
  '79733-2': 'TPMT',
  '79747-2': 'DPYD',
  '79716-8': 'SLCO1B1',
};

const PGX_LOINC_CODES = Object.keys(PGX_LOINC_TO_GENE);

/**
 * Normalize a free-text phenotype string from a FHIR Observation into one of
 * the canonical CYPPhenotype values used by the pharmacogenomics tool.
 *
 * Matching is case-insensitive substring; we look for the most-specific
 * pattern first ("ultrarapid" / "ultra-rapid" / "ultra rapid" / " um " / "*1/*1xN"
 * could all map to ultrarapid_metabolizer in real labs). Unknown strings
 * return null and the caller drops the result.
 */
export function normalizePhenotype(text: string): CYPPhenotype | null {
  const t = text.toLowerCase().trim();
  if (/(ultra[\s\-_]?rapid|ultrarapid|\bum\b)/.test(t)) return 'ultrarapid_metabolizer';
  if (/(\brapid\b|\brm\b)/.test(t) && !/intermediate/.test(t)) return 'rapid_metabolizer';
  if (/(poor|pm\b|nonfunctional)/.test(t)) return 'poor_metabolizer';
  if (/(intermediate|im\b)/.test(t)) return 'intermediate_metabolizer';
  if (/(normal|extensive|em\b|wild[\s\-]?type|\*1\/\*1)/.test(t)) return 'normal_metabolizer';
  return null;
}

/**
 * Pulls PGx phenotype Observations for a patient from a live FHIR server and
 * returns a `{ gene → phenotype }` record suitable for the pharmacogenomics
 * MCP tool's `genotypes` input.
 *
 * Errors are non-fatal: if a single Observation can't be parsed it's skipped
 * with a warn log; if the entire fetch fails the function returns an empty
 * record so the review pipeline can still run (PGx tool degrades gracefully
 * to "no genotypes available, all calls remain empirical").
 */
export async function loadPatientGenotypes(
  client: FHIRClient,
  patientId: string
): Promise<Record<string, CYPPhenotype>> {
  let obs: FHIRObservation[];
  try {
    obs = await client.getObservations(patientId, PGX_LOINC_CODES);
  } catch (err) {
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      svc: 'fhir',
      level: 'warn',
      msg: 'PGx Observation fetch failed; returning empty genotypes',
      patientId,
      error: (err as Error).message,
    }));
    return {};
  }

  const out: Record<string, CYPPhenotype> = {};
  for (const o of obs) {
    const loinc = o.code?.coding?.find(c => PGX_LOINC_TO_GENE[c.code ?? ''])?.code;
    const gene = loinc ? PGX_LOINC_TO_GENE[loinc] : undefined;
    if (!gene) continue;

    // Try valueCodeableConcept.text → coding[].display → valueString
    const valueText =
      o.valueCodeableConcept?.text
      ?? o.valueCodeableConcept?.coding?.find(c => c.display)?.display
      ?? o.valueString;
    if (!valueText || typeof valueText !== 'string') continue;

    const phenotype = normalizePhenotype(valueText);
    if (!phenotype) {
      console.error(JSON.stringify({
        ts: new Date().toISOString(),
        svc: 'fhir',
        level: 'warn',
        msg: 'Unknown PGx phenotype string; dropping',
        patientId,
        gene,
        rawValue: valueText,
      }));
      continue;
    }

    // Most-recent-wins if the same gene has multiple Observations.
    if (!(gene in out)) out[gene] = phenotype;
  }

  return out;
}
