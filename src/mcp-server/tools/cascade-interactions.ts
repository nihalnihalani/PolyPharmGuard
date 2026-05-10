import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { CascadeFinding, DrugKBEntry, PatientContext, CascadeChainStep } from '../../types/clinical.js';
import type { FHIRContextHeaders } from '../../types/mcp.js';
import { analyzeWithGemini } from '../../llm/gemini.js';
import { validateClinicalOutput, ensureNoFHIRCredentials } from '../../llm/guardrails.js';
import { buildCascadePrompt } from '../prompts/cascade-prompt.js';
import { gateLLMFindings, buildCandidateSet, type KBCandidate } from '../../llm/evidence-gate.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const KB_DIR = join(__dirname, '../../knowledge-base');
// data/ ships under dist/data via the package postbuild script. The path
// resolves the same way regardless of whether we're running from `src/` (tsx)
// or `dist/` (compiled) — both layouts put `data/rxnorm/` four levels up from
// `tools/`.
const DATA_DIR = join(__dirname, '../../../data');

interface ComboProduct {
  name: string;
  aliases?: string[];
  rxnormCui: string;
  ingredients: string[];
  source: string;
}

interface ComboProductsFile {
  products: ComboProduct[];
}

let _comboProductsCache: ComboProduct[] | null = null;
function loadComboProducts(): ComboProduct[] {
  if (_comboProductsCache) return _comboProductsCache;
  try {
    const raw = JSON.parse(
      readFileSync(join(DATA_DIR, 'rxnorm/combo-products.json'), 'utf-8')
    ) as ComboProductsFile;
    _comboProductsCache = raw.products ?? [];
  } catch {
    // Combo-product table is optional — if missing or malformed, fall back to
    // single-ingredient parsing. We never throw from a KB load path because
    // missing reference data must not crash the cascade tool.
    _comboProductsCache = [];
  }
  return _comboProductsCache;
}

interface InhibitorEntry {
  drug: string;
  rxnormCui: string;
  inhibitions: Array<{ enzyme: string; strength: string; source: string }>;
}

interface InducerEntry {
  drug: string;
  rxnormCui: string;
  inductions: Array<{ enzyme: string; strength: string; source: string }>;
}

interface RenalDosingEntry {
  drug: string;
  rxnormCui: string;
  adjustments: Array<{
    egfrRange: { min: number | null; max: number | null };
    recommendation: string;
    contraindicated: boolean;
    source: string;
  }>;
}

function loadKB() {
  const substrates: DrugKBEntry[] = JSON.parse(
    readFileSync(join(KB_DIR, 'cyp450/substrates.json'), 'utf-8')
  );
  const inhibitors: InhibitorEntry[] = JSON.parse(
    readFileSync(join(KB_DIR, 'cyp450/inhibitors.json'), 'utf-8')
  );
  const inducers: InducerEntry[] = JSON.parse(
    readFileSync(join(KB_DIR, 'cyp450/inducers.json'), 'utf-8')
  );
  const renalDosing: RenalDosingEntry[] = JSON.parse(
    readFileSync(join(KB_DIR, 'renal-hepatic/renal-dosing.json'), 'utf-8')
  );
  return { substrates, inhibitors, inducers, renalDosing };
}

// Returns true only when the substrate is renally cleared enough that severe
// CKD would meaningfully amplify accumulation. We use the renal-dosing KB as
// ground truth: if any adjustment for eGFR ≤30 is contraindicated or carries
// a real recommendation (not a "no adjustment / hepatically metabolized"
// no-op), we treat the substrate as renally cleared.
function substrateHasRenalClearance(
  substrateName: string,
  renalDosing: RenalDosingEntry[]
): boolean {
  const normalized = substrateName.toLowerCase();
  const entry = renalDosing.find(e =>
    normalized.startsWith(e.drug.toLowerCase()) || e.drug.toLowerCase().startsWith(normalized)
  );
  if (!entry) return false;
  return entry.adjustments.some(adj => {
    const min = adj.egfrRange.min ?? 0;
    const appliesAtSevere = min <= 30;
    if (!appliesAtSevere) return false;
    if (adj.contraindicated) return true;
    const rec = adj.recommendation.toLowerCase();
    // Skip recommendations that explicitly say no clearance-based adjustment is
    // needed. Catches "No renal dose adjustment", "No dose adjustment required",
    // "Standard dosing", "No formal dose adjustment based on eGFR", and
    // hepatically-metabolized phrasings that describe other risks (myopathy,
    // sensitivity) without claiming kidney-clearance amplification.
    if (
      /^(no renal|no dose adjustment|no formal|standard dosing|standard dose|standard doses)/.test(rec) ||
      /hepatically metabolized/.test(rec)
    ) {
      return false;
    }
    return true;
  });
}

export interface ParsedRxNormProduct {
  /** One or more ingredient names, lowercased + trimmed. Combo products
   *  (e.g. Paxlovid → [nirmatrelvir, ritonavir]) yield multiple ingredients. */
  ingredients: string[];
  /** Numeric dose (e.g. 40 from "atorvastatin 40mg"), if extractable. */
  dose?: number;
  /** Dose unit (e.g. "mg", "mcg", "meq"). Lowercased. */
  unit?: string;
  /** Frequency keyword (e.g. "daily", "bid", "tid"). Lowercased. */
  frequency?: string;
}

const FREQUENCY_RE = /\b(once daily|twice daily|three times daily|daily|bid|tid|qid|qhs|qam|qpm|q\s*\d+\s*h|every\s*\d+\s*hours?|prn|once|twice|three times)\b/i;
const DOSE_RE = /(\d+(?:\.\d+)?)\s*(mg|mcg|ml|meq|g|units?)/i;

/**
 * Parse a medication display string into ingredients + optional dose/freq.
 *
 * Combo-product handling:
 *  - We first check the combo-products table (data/rxnorm/combo-products.json).
 *  - If the lowercased input contains a combo product's name OR any of its
 *    aliases, the ingredient list expands to that product's ingredients.
 *  - Slash-separated forms (e.g. "Nirmatrelvir/Ritonavir") that aren't in the
 *    table also split on '/' as a graceful fallback.
 *  - Single-ingredient meds (the common case) yield a one-element ingredients
 *    array.
 *
 * Dose/freq extraction is best-effort — the cascade tool only needs ingredients
 * to match the KB; dose+frequency are surfaced for downstream consumers (renal
 * dosing tool can call this too without re-parsing).
 */
export function parseRxNormProduct(name: string): ParsedRxNormProduct {
  const lower = name.toLowerCase().trim();

  // Strip trailing "(brand)" annotations so they don't confuse alias matching.
  // Keep the brand visible to combo-table matching by NOT stripping it from
  // the search string used below — only used when computing the fallback
  // single-ingredient name.
  const stripped = lower
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Pull dose + frequency out of the raw string before ingredient resolution.
  let dose: number | undefined;
  let unit: string | undefined;
  const doseMatch = lower.match(DOSE_RE);
  if (doseMatch) {
    dose = parseFloat(doseMatch[1]);
    unit = doseMatch[2].toLowerCase();
  }
  let frequency: string | undefined;
  const freqMatch = lower.match(FREQUENCY_RE);
  if (freqMatch) frequency = freqMatch[1].toLowerCase();

  // Combo-product table lookup. A product matches if its `name` OR any of its
  // `aliases` appears as a substring of the lowercased input.
  for (const product of loadComboProducts()) {
    const candidates = [product.name, ...(product.aliases ?? [])].map(s => s.toLowerCase());
    const hit = candidates.some(c => lower.includes(c));
    if (hit) {
      return {
        ingredients: product.ingredients.map(i => i.toLowerCase().trim()),
        dose,
        unit,
        frequency,
      };
    }
  }

  // Slash-separated fallback: "Nirmatrelvir/Ritonavir 300/100mg" → split on /
  // (only when each side, after stripping dose tokens, looks like a plausible
  // ingredient name — alphabetic, ≥3 chars). This catches combo products we
  // haven't enumerated yet without producing junk like ["20mg", "12.5mg"].
  if (stripped.includes('/')) {
    const parts = stripped
      .split('/')
      .map(p => p
        .replace(DOSE_RE, '')
        .replace(FREQUENCY_RE, '')
        .replace(/\bpo\b|\bpr\b|\bsl\b|\biv\b|\bim\b|\bsq\b/gi, '')
        .trim()
      )
      .filter(p => /^[a-z][a-z\s-]{2,}$/i.test(p));
    if (parts.length >= 2) {
      return { ingredients: parts.map(p => p.toLowerCase()), dose, unit, frequency };
    }
  }

  // Single-ingredient: strip dose+frequency tokens, return.
  const singleIngredient = lower
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s*\d+(?:\.\d+)?\s*(mg|mcg|ml|meq|g|units?)\s*(daily|bid|tid|qid|once|twice|three times)?.*/i, '')
    .replace(FREQUENCY_RE, '')
    .replace(/\bpo\b|\bpr\b|\bsl\b|\biv\b|\bim\b|\bsq\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    ingredients: singleIngredient.length > 0 ? [singleIngredient] : [lower],
    dose,
    unit,
    frequency,
  };
}

/**
 * Legacy compatibility shim. Pre-RxNorm code paths called normalizeDrugName()
 * and treated the return as a single string. This keeps the contract for
 * non-combo callers (which is the common case) and returns the FIRST ingredient
 * for combo products. New code should call parseRxNormProduct() directly.
 *
 * The `web/components/DrugInteractionGraph.tsx` mirror of this function uses
 * the same single-string contract for cytoscape node ids; combo products there
 * still render under the first ingredient's name (acceptable since the cascade
 * edges generated server-side already point at specific ingredients).
 */
export function normalizeDrugName(name: string): string {
  const parsed = parseRxNormProduct(name);
  return parsed.ingredients[0] ?? name.toLowerCase().trim();
}

/**
 * Match a single ingredient name to a KB row. The ingredient is already
 * lowercased + dose-stripped by parseRxNormProduct.
 */
function matchIngredientToKB<T extends { drug: string; rxnormCui: string }>(
  ingredient: string,
  kb: T[]
): T | undefined {
  const normalized = ingredient.toLowerCase().trim();
  return kb.find(entry =>
    entry.drug.toLowerCase() === normalized ||
    entry.drug.toLowerCase().startsWith(normalized) ||
    normalized.startsWith(entry.drug.toLowerCase())
  );
}

/**
 * Match a medication string to KB. For combo products, returns the FIRST
 * matching ingredient's KB row — kept for the small number of legacy call
 * sites (e.g. unknown-drug detection) that just need to know "is any
 * ingredient in the KB?". The detailed cascade detector iterates ingredients
 * directly via parseRxNormProduct + matchIngredientToKB.
 */
function matchDrugToKB<T extends { drug: string; rxnormCui: string }>(
  name: string,
  kb: T[]
): T | undefined {
  const parsed = parseRxNormProduct(name);
  for (const ing of parsed.ingredients) {
    const hit = matchIngredientToKB(ing, kb);
    if (hit) return hit;
  }
  return undefined;
}

function detectAlgorithmicCascades(
  medications: string[],
  substrates: DrugKBEntry[],
  inhibitors: InhibitorEntry[],
  inducers: InducerEntry[],
  renalDosing: RenalDosingEntry[],
  patientContext: PatientContext | null
): CascadeFinding[] {
  const findings: CascadeFinding[] = [];

  // Expand each medication into one entry per RxNorm ingredient so combo
  // products (Paxlovid → nirmatrelvir + ritonavir) get matched against the
  // KB on every ingredient independently. The displayed `name` stays as the
  // original combo string so a finding's contributing-drug list reads
  // naturally ("Nirmatrelvir/Ritonavir (Paxlovid)") even when the matched
  // ingredient is one component (ritonavir).
  type MedMatch = {
    name: string;        // original medication display
    normalized: string;  // ingredient name (lowercased)
    substrate?: DrugKBEntry;
    inhibitor?: InhibitorEntry;
    inducer?: InducerEntry;
  };
  const medMatches: MedMatch[] = medications.flatMap(med => {
    const parsed = parseRxNormProduct(med);
    return parsed.ingredients.map(ingredient => ({
      name: med,
      normalized: ingredient,
      substrate: matchIngredientToKB(ingredient, substrates),
      inhibitor: matchIngredientToKB(ingredient, inhibitors),
      inducer: matchIngredientToKB(ingredient, inducers),
    }));
  });

  // Build enzyme maps
  const enzymeInhibitors = new Map<string, typeof medMatches>();
  const enzymeSubstrates = new Map<string, typeof medMatches>();
  const enzymeInducers = new Map<string, typeof medMatches>();

  for (const med of medMatches) {
    if (med.inhibitor) {
      for (const inh of med.inhibitor.inhibitions) {
        if (!enzymeInhibitors.has(inh.enzyme)) enzymeInhibitors.set(inh.enzyme, []);
        enzymeInhibitors.get(inh.enzyme)!.push(med);
      }
    }
    if (med.substrate?.cypRelationships.length) {
      for (const sub of med.substrate.cypRelationships) {
        if (!enzymeSubstrates.has(sub.enzyme)) enzymeSubstrates.set(sub.enzyme, []);
        enzymeSubstrates.get(sub.enzyme)!.push(med);
      }
    }
    if (med.inducer) {
      for (const ind of med.inducer.inductions) {
        if (!enzymeInducers.has(ind.enzyme)) enzymeInducers.set(ind.enzyme, []);
        enzymeInducers.get(ind.enzyme)!.push(med);
      }
    }
  }

  // Detect inhibitor -> substrate pairs
  for (const [enzyme, inhibitorMeds] of enzymeInhibitors.entries()) {
    const substrateMeds = enzymeSubstrates.get(enzyme) ?? [];

    for (const inhibitorMed of inhibitorMeds) {
      for (const substrateMed of substrateMeds) {
        // Don't flag a drug interacting with itself
        if (inhibitorMed.normalized === substrateMed.normalized) continue;

        const inhibitorEntry = inhibitorMed.inhibitor!;
        const substrateEntry = substrateMed.substrate!;
        const inhibition = inhibitorEntry.inhibitions.find(i => i.enzyme === enzyme)!;
        const substrateRel = substrateEntry.cypRelationships.find(r => r.enzyme === enzyme)!;

        const isMajorSubstrate = substrateRel.role.includes('major');
        const isStrongInhibitor = inhibition.strength.includes('strong');
        const isModerateInhibitor = inhibition.strength.includes('moderate');
        const isProdrug = substrateEntry.prodrug === true;

        // Detect post-DES / post-stent context — escalates prodrug findings to CRITICAL.
        // Loss of antiplatelet efficacy in a stented patient is a life-threatening
        // stent-thrombosis risk (per FDA Black Box Warning, clopidogrel 2010).
        const conditionsBlob = (patientContext?.conditions ?? [])
          .map((c) => JSON.stringify(c).toLowerCase())
          .join(' ');
        const hasStentContext = /stent|\bdes\b|drug.eluting|pci|percutaneous coronary/.test(conditionsBlob);

        // Determine severity
        // Severe renal impairment (eGFR < 30) escalates inhibition by one tier
        // ONLY when the substrate is actually renally cleared. Escalating
        // hepatically-metabolized substrates (e.g. omeprazole, simvastatin)
        // produces clinically false CRITICAL findings.
        const severeRenal =
          patientContext?.egfr !== undefined &&
          patientContext.egfr < 30 &&
          substrateHasRenalClearance(substrateMed.normalized, renalDosing);
        let severity: CascadeFinding['severity'] = 'LOW';
        if (isStrongInhibitor && isMajorSubstrate) {
          severity = severeRenal ? 'CRITICAL' : 'HIGH';
        } else if (isStrongInhibitor || (isModerateInhibitor && isMajorSubstrate)) {
          severity = severeRenal ? 'HIGH' : 'MODERATE';
        }
        // Prodrug + post-stent context → CRITICAL regardless (stent thrombosis risk).
        if (isProdrug && hasStentContext) {
          severity = 'CRITICAL';
        }

        // Build evidence chain — branched for prodrug substrates.
        // For a prodrug, CYP inhibition REDUCES active metabolite formation
        // (loss of efficacy), not increases plasma levels (toxicity).
        const chain: CascadeChainStep[] = isProdrug
          ? [
              {
                step: 1,
                fact: `${inhibitorMed.name} is a ${inhibition.strength.replace('_', ' ')} of ${enzyme}`,
                source: inhibition.source,
              },
              {
                step: 2,
                fact: `${substrateMed.name} is a PRODRUG that requires ${enzyme} bioactivation to its active metabolite`,
                source: substrateRel.source,
              },
              {
                step: 3,
                fact: `${enzyme} inhibition by ${inhibitorMed.name} REDUCES active metabolite formation of ${substrateMed.name}, causing LOSS of therapeutic efficacy (not toxicity)`,
                source: substrateEntry.prodrugNote
                  ? `${inhibition.source}; ${substrateEntry.prodrugNote.split('.')[0]}.`
                  : `${inhibition.source} (prodrug bioactivation pathway)`,
              },
            ]
          : [
              {
                step: 1,
                fact: `${inhibitorMed.name} is a ${inhibition.strength.replace('_', ' ')} of ${enzyme}`,
                source: inhibition.source,
              },
              {
                step: 2,
                fact: `${substrateMed.name} is a ${substrateRel.role.replace('_', ' ')} of ${enzyme}, meaning its metabolism depends critically on this enzyme`,
                source: substrateRel.source,
              },
              {
                step: 3,
                fact: `${enzyme} inhibition by ${inhibitorMed.name} reduces metabolism of ${substrateMed.name}, increasing plasma levels${isStrongInhibitor && isMajorSubstrate ? ' up to 5-20 fold' : ''}`,
                source: `${inhibition.source} (pharmacokinetic consequence of enzyme inhibition)`,
              },
            ];

        if (
          patientContext?.egfr !== undefined &&
          patientContext.egfr < 30 &&
          substrateHasRenalClearance(substrateMed.normalized, renalDosing)
        ) {
          chain.push({
            step: 4,
            fact: `Patient eGFR of ${patientContext.egfr} mL/min indicates CKD Stage 4; ${substrateMed.name} has documented renal clearance per FDA labeling, so reduced GFR amplifies accumulation risk on top of the CYP inhibition above`,
            source: 'FHIR Observation (eGFR) + FDA renal dosing label',
          });
        }

        if (isProdrug && hasStentContext) {
          chain.push({
            step: chain.length + 1,
            fact: `Patient has post-DES/stent context — loss of ${substrateMed.name} antiplatelet efficacy raises stent thrombosis risk (FDA Black Box Warning, 2010)`,
            source: 'FHIR Condition (post-DES/stent)',
          });
        }

        const primarySource = isProdrug
          ? `${inhibition.source}; FDA Black Box Warning (clopidogrel + CYP2C19 inhibitors, 2010)`
          : inhibition.source;

        const finding: CascadeFinding = isProdrug
          ? {
              finding: `${enzyme} INHIBITION → REDUCED active metabolite of ${substrateMed.name}: ${inhibitorMed.name} blocks ${enzyme} activation of ${substrateMed.name} prodrug → loss of therapeutic efficacy`,
              severity,
              chain,
              clinicalConsequence:
                substrateEntry.prodrugNote
                  ? `Antiplatelet/therapeutic efficacy COMPROMISED — ${substrateMed.name} cannot be activated. ${hasStentContext ? 'In post-DES/DAPT patients this is stent thrombosis risk. ' : ''}FDA Black Box Warning (clopidogrel + CYP2C19 inhibitors, 2010).`
                  : `Antiplatelet/therapeutic efficacy COMPROMISED — ${substrateMed.name} cannot be activated by ${enzyme}. ${hasStentContext ? 'In post-DES/DAPT patients this is stent thrombosis risk. ' : ''}FDA Black Box Warning (clopidogrel + CYP2C19 inhibitors, 2010).`,
              recommendation: `Switch ${inhibitorMed.name} to a non-${enzyme} alternative (e.g., for fluvoxamine/CYP2C19 → sertraline or escitalopram). Continue ${substrateMed.name} at current dose. Do NOT reduce ${substrateMed.name} — the problem is underactivation, not toxicity.`,
              source: primarySource,
              contributingDrugs: [inhibitorMed.normalized, substrateMed.normalized],
            }
          : {
              finding: `${enzyme} INHIBITION CASCADE: ${inhibitorMed.name} → ↑${substrateMed.name} levels`,
              severity,
              chain,
              clinicalConsequence: `Elevated ${substrateMed.name} plasma levels due to ${enzyme} inhibition by ${inhibitorMed.name}. Risk of ${substrateMed.name}-associated toxicity.`,
              recommendation: `Monitor for ${substrateMed.name} toxicity. Consider reducing ${substrateMed.name} dose or switching to an alternative not metabolized by ${enzyme}.`,
              source: primarySource,
              contributingDrugs: [inhibitorMed.normalized, substrateMed.normalized],
            };

        findings.push(finding);
      }
    }
  }

  return findings;
}

const SEVERITY_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, MODERATE: 2, LOW: 3, INFO: 4 };

export async function analyzeCascadeInteractions(input: {
  medications: string[];
  patientContext?: PatientContext | null;
  fhirContext?: FHIRContextHeaders;
}): Promise<CascadeFinding[]> {
  const { medications, patientContext = null } = input;

  if (!medications || medications.length === 0) {
    return [];
  }

  // Load KB
  const { substrates, inhibitors, inducers, renalDosing } = loadKB();

  // Match meds to KB. Combo products expand to per-ingredient matches so we
  // include every ingredient that the substrate KB knows about.
  const kbMatches: DrugKBEntry[] = [];
  const seenSubstrateCuis = new Set<string>();
  for (const med of medications) {
    const parsed = parseRxNormProduct(med);
    for (const ingredient of parsed.ingredients) {
      const hit = matchIngredientToKB(ingredient, substrates);
      if (hit && !seenSubstrateCuis.has(hit.rxnormCui)) {
        kbMatches.push(hit);
        seenSubstrateCuis.add(hit.rxnormCui);
      }
    }
  }

  // Identify drugs not in KB. A medication is "unknown" only if NONE of its
  // RxNorm ingredients matches any of substrates/inhibitors/inducers — combo
  // products with at least one known ingredient are not flagged. For combo
  // products where SOME ingredients are unknown, we surface those individually
  // so a clinician can see exactly which constituent lacks KB coverage rather
  // than silently skipping it.
  const unknownDrugs: string[] = [];
  for (const med of medications) {
    const parsed = parseRxNormProduct(med);
    if (parsed.ingredients.length === 1) {
      const ing = parsed.ingredients[0];
      const anyMatch =
        matchIngredientToKB(ing, substrates) ||
        matchIngredientToKB(ing, inhibitors) ||
        matchIngredientToKB(ing, inducers);
      if (!anyMatch) unknownDrugs.push(med);
    } else {
      // Combo product: list any ingredient that is unknown to the KB.
      const missing = parsed.ingredients.filter(ing =>
        !matchIngredientToKB(ing, substrates) &&
        !matchIngredientToKB(ing, inhibitors) &&
        !matchIngredientToKB(ing, inducers)
      );
      if (missing.length === parsed.ingredients.length) {
        // All ingredients unknown — list the original combo display.
        unknownDrugs.push(med);
      } else if (missing.length > 0) {
        // Partial: surface the unknown components inline so the manual-review
        // line names them (devil's advocate adversarial test for combo
        // products with unknown ingredients).
        unknownDrugs.push(`${med} (unknown ingredient${missing.length > 1 ? 's' : ''}: ${missing.join(', ')})`);
      }
    }
  }

  // Run algorithmic pre-filter (deterministic, no LLM)
  const algorithmicFindings = detectAlgorithmicCascades(
    medications, substrates, inhibitors, inducers, renalDosing, patientContext
  );

  // Build LLM prompt
  const { systemPrompt, userPrompt } = buildCascadePrompt(
    medications, kbMatches, inhibitors, inducers, patientContext
  );

  // Sanitize prompt
  const sanitizedPrompt = ensureNoFHIRCredentials(userPrompt);

  // Call Gemini
  const llmResponse = await analyzeWithGemini(systemPrompt, sanitizedPrompt);

  // Parse LLM response
  let llmFindings: CascadeFinding[] = [];
  if (llmResponse && !llmResponse.includes('LLM analysis unavailable')) {
    try {
      const match = llmResponse.match(/\[[\s\S]*\]/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed)) {
          llmFindings = parsed as CascadeFinding[];
        }
      }
    } catch {
      console.error('[cascade] Failed to parse LLM JSON response, using algorithmic findings');
    }
  }

  // Use algorithmic findings as ground truth, LLM findings supplement
  const merged = [...algorithmicFindings];
  for (const llmFinding of llmFindings) {
    const isDuplicate = algorithmicFindings.some(af =>
      af.finding.toLowerCase().includes(llmFinding.finding.toLowerCase().split(':')[0].toLowerCase()) ||
      llmFinding.finding.toLowerCase().includes(af.finding.toLowerCase().split(':')[0].toLowerCase())
    );
    if (!isDuplicate) merged.push(llmFinding);
  }
  const findings = merged;

  // Add manual review flags for unknown drugs
  if (unknownDrugs.length > 0) {
    findings.push({
      finding: `MANUAL REVIEW REQUIRED: ${unknownDrugs.join(', ')} not found in CYP450 knowledge base`,
      severity: 'INFO',
      chain: [],
      clinicalConsequence: 'Cannot assess CYP450 interactions for these medications without knowledge base data.',
      recommendation: 'Consult clinical pharmacology resources for these medications.',
      source: 'PolyPharmGuard CYP450 knowledge base coverage gap (no FDA Drug Interactions Table entry for the listed drug)',
    });
  }

  // Backfill source for any LLM-parsed finding that didn't include one — the
  // schema in clinical.ts requires a top-level source on every finding.
  for (const f of findings) {
    if (!f.source || typeof f.source !== 'string' || f.source.trim() === '') {
      f.source = 'Gemini cascade analysis grounded on PolyPharmGuard CYP450 KB';
    }
  }

  // Validate output
  const { warnings } = validateClinicalOutput(findings.map(f => f.finding).join(' '), medications);
  if (warnings.length > 0) {
    console.error('[cascade] Validation warnings:', warnings);
  }

  // Sort by severity
  return findings.sort((a, b) =>
    (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99)
  );
}
