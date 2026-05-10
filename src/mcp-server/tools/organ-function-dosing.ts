import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { DosingFinding, PatientContext } from '../../types/clinical.js';
import type { FHIRContextHeaders } from '../../types/mcp.js';
import { analyzeWithGemini } from '../../llm/gemini.js';
import { ensureNoFHIRCredentials } from '../../llm/guardrails.js';
import { buildDosingPrompt } from '../prompts/dosing-prompt.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const KB_DIR = join(__dirname, '../../knowledge-base');

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

interface HepaticDosingEntry {
  drug: string;
  rxnormCui: string;
  contraindicated?: boolean;
  contraindicationNote?: string;
  childPughCategories: Array<{
    category: string;
    recommendation: string;
    source: string;
  }>;
}

function loadDosingKB(): { renalDosing: RenalDosingEntry[]; hepaticDosing: HepaticDosingEntry[] } {
  const renalDosing: RenalDosingEntry[] = JSON.parse(
    readFileSync(join(KB_DIR, 'renal-hepatic/renal-dosing.json'), 'utf-8')
  );
  const hepaticDosing: HepaticDosingEntry[] = JSON.parse(
    readFileSync(join(KB_DIR, 'renal-hepatic/hepatic-dosing.json'), 'utf-8')
  );
  return { renalDosing, hepaticDosing };
}

function normalizeDrugName(name: string): string {
  return name.toLowerCase().trim().replace(/\s*\d+\s*(mg|mcg|ml|mEq|g)\s*(daily|bid|tid|once|twice|three times)?.*/i, '').trim();
}

// ---------------------------------------------------------------------------
// FHIR dosageInstruction → actual daily dose math
//
// Reads the FHIR R4 MedicationRequest.dosageInstruction[].doseAndRate[].
// doseQuantity.value plus the timing.repeat frequency/period to compute a
// concrete actual daily dose. Best-effort: when the dosageInstruction is
// unparseable (free-text only, missing timing, or a tapered/PRN regimen),
// returns undefined and the caller falls back to the qualitative finding.
//
// Example: gabapentin 300mg with timing.repeat = { frequency: 3, period: 1,
// periodUnit: "d" } → 900 mg/day.
// ---------------------------------------------------------------------------
interface DailyDose {
  value: number;
  unit: string;
}

function extractDailyDose(medReq: {
  dosageInstruction?: Array<{
    doseAndRate?: Array<{ doseQuantity?: { value?: number; unit?: string } }>;
    timing?: { repeat?: { frequency?: number; period?: number; periodUnit?: string } };
  }>;
}): DailyDose | undefined {
  const instr = medReq.dosageInstruction?.[0];
  if (!instr) return undefined;
  const doseQty = instr.doseAndRate?.[0]?.doseQuantity;
  if (!doseQty || typeof doseQty.value !== 'number') return undefined;
  const repeat = instr.timing?.repeat;
  if (!repeat || typeof repeat.frequency !== 'number' || typeof repeat.period !== 'number') {
    return undefined;
  }
  // Convert frequency/period to per-day. "frequency: 3, period: 1, periodUnit: d" → 3/day.
  const perPeriod = repeat.frequency / repeat.period;
  const perDay =
    repeat.periodUnit === 'h' ? perPeriod * 24
    : repeat.periodUnit === 'min' ? perPeriod * 24 * 60
    : repeat.periodUnit === 'wk' ? perPeriod / 7
    : perPeriod; // default: per day
  const value = Math.round(doseQty.value * perDay * 100) / 100;
  return { value, unit: (doseQty.unit ?? 'mg').toLowerCase() };
}

// Parse a daily-max from a free-text renal dosing recommendation. Catches
// "Max dose 300mg once daily", "Maximum 1500mg/day", "300mg/d max".
// Returns undefined for relative or qualitative recommendations.
function parseDailyMaxFromRecommendation(rec: string): number | undefined {
  const m = rec.match(/(?:max(?:imum)?\s*(?:dose)?\s*|cap(?:ped)?\s*at\s*|do not exceed\s*)(\d+(?:\.\d+)?)\s*mg/i);
  if (m) return parseFloat(m[1]);
  const m2 = rec.match(/(\d+(?:\.\d+)?)\s*mg(?:\s*\/\s*d(?:ay)?|\s*per\s*day)?\s*(?:max|maximum|ceiling)/i);
  if (m2) return parseFloat(m2[1]);
  return undefined;
}

function matchDrugToDosingKB<T extends { drug: string }>(name: string, kb: T[]): T | undefined {
  const normalized = normalizeDrugName(name);
  return kb.find(entry =>
    entry.drug.toLowerCase() === normalized ||
    entry.drug.toLowerCase().startsWith(normalized) ||
    normalized.startsWith(entry.drug.toLowerCase())
  );
}

/**
 * Assess hepatic dysfunction. Returns proper Child-Pugh A/B/C only when ALL 5
 * components (bilirubin, albumin, INR, ascites, encephalopathy) are available.
 *
 * When components are missing, falls back to a "Hepatic Risk Indicator" based on
 * available transaminases/bilirubin and returns an explicit disclaimer that the
 * surrogate is NOT a true Child-Pugh score.
 *
 * Real Child-Pugh component thresholds (1/2/3 points each):
 *   - Bilirubin (mg/dL): <2 / 2-3 / >3
 *   - Albumin (g/dL):    >3.5 / 2.8-3.5 / <2.8
 *   - INR:               <1.7 / 1.7-2.3 / >2.3
 *   - Ascites:           none / mild / moderate-severe
 *   - Encephalopathy:    none / grade 1-2 / grade 3-4
 * Total: A = 5-6, B = 7-9, C = 10-15
 */
function assessHepaticRisk(ctx: PatientContext): {
  category: 'A' | 'B' | 'C' | null;
  label: string;
  basis: string;
  disclaimer?: string;
} {
  const haveAllChildPugh =
    ctx.bilirubin !== undefined &&
    ctx.albumin !== undefined &&
    ctx.inr !== undefined &&
    ctx.ascites !== undefined &&
    ctx.encephalopathy !== undefined;

  if (haveAllChildPugh) {
    // Real Child-Pugh
    const bilirubin = ctx.bilirubin!;
    const albumin = ctx.albumin!;
    const inr = ctx.inr!;
    const ascites = ctx.ascites!;
    const encephalopathy = ctx.encephalopathy!;

    const bilirubinPts = bilirubin < 2 ? 1 : bilirubin <= 3 ? 2 : 3;
    const albuminPts = albumin > 3.5 ? 1 : albumin >= 2.8 ? 2 : 3;
    const inrPts = inr < 1.7 ? 1 : inr <= 2.3 ? 2 : 3;
    const ascitesPts = ascites === 'none' ? 1 : ascites === 'mild' ? 2 : 3;
    const encephPts = encephalopathy === 'none' ? 1 : encephalopathy === 'grade1-2' ? 2 : 3;

    const total = bilirubinPts + albuminPts + inrPts + ascitesPts + encephPts;
    const category: 'A' | 'B' | 'C' = total <= 6 ? 'A' : total <= 9 ? 'B' : 'C';
    return {
      category,
      label: 'Child-Pugh',
      basis: `score ${total}/15 (bilirubin ${bilirubin}, albumin ${albumin}, INR ${inr}, ascites ${ascites}, encephalopathy ${encephalopathy})`,
    };
  }

  // Surrogate fallback — NOT a real Child-Pugh score. Signal this explicitly.
  const alt = ctx.alt ?? 0;
  const bilirubin = ctx.bilirubin ?? 0;

  if (alt <= 120 && bilirubin <= 2.0) {
    return { category: 'A', label: 'Hepatic Risk Indicator', basis: `ALT ${ctx.alt ?? 'n/a'}, bilirubin ${ctx.bilirubin ?? 'n/a'}`, disclaimer: 'surrogate — not Child-Pugh; albumin/INR/ascites/encephalopathy unavailable' };
  }

  // Map to A/B/C-like surrogate buckets so existing KB recommendations still apply
  let surrogateCategory: 'A' | 'B' | 'C';
  if (bilirubin > 3.0 || alt > 200) surrogateCategory = 'C';
  else if (bilirubin > 2.0 || alt > 120) surrogateCategory = 'B';
  else surrogateCategory = 'A';

  return {
    category: surrogateCategory,
    label: 'Hepatic Risk Indicator',
    basis: `ALT ${ctx.alt ?? 'n/a'}, bilirubin ${ctx.bilirubin ?? 'n/a'}`,
    disclaimer: 'surrogate — not a true Child-Pugh score; full assessment requires albumin, INR, ascites grade, and encephalopathy grade',
  };
}

function getApplicableAdjustment(
  entry: RenalDosingEntry,
  egfr: number
): RenalDosingEntry['adjustments'][0] | undefined {
  return entry.adjustments.find(adj => {
    const min = adj.egfrRange.min ?? -Infinity;
    const max = adj.egfrRange.max ?? Infinity;
    return egfr >= min && egfr <= max;
  }) ?? entry.adjustments.find(adj => {
    // Also try: max null means >= min, min null means < max
    if (adj.egfrRange.min === null && adj.egfrRange.max !== null) return egfr < adj.egfrRange.max;
    if (adj.egfrRange.max === null && adj.egfrRange.min !== null) return egfr >= adj.egfrRange.min;
    return false;
  });
}

function detectAlgorithmicDosingIssues(
  medications: string[],
  renalDosing: RenalDosingEntry[],
  hepaticDosing: HepaticDosingEntry[],
  patientContext: PatientContext | null
): DosingFinding[] {
  const findings: DosingFinding[] = [];

  if (!patientContext) {
    findings.push({
      finding: 'Cannot assess organ function dosing: No patient context or lab values available',
      severity: 'INFO',
      medication: 'All medications',
      threshold: 'N/A',
      recommendation: 'Obtain eGFR and liver function tests to enable organ-function dosing assessment.',
      source: 'PolyPharmGuard organ-function dosing tool — patient-context coverage gap (no eGFR/LFT FHIR Observations available)',
    });
    return findings;
  }

  for (const med of medications) {
    // Renal dosing check
    if (patientContext.egfr !== undefined) {
      const renalEntry = matchDrugToDosingKB(med, renalDosing);
      if (renalEntry) {
        const applicable = getApplicableAdjustment(renalEntry, patientContext.egfr);
        if (applicable && applicable.recommendation && !applicable.recommendation.startsWith('No dose adjustment') && !applicable.recommendation.startsWith('Standard dosing') && !applicable.recommendation.startsWith('No renal')) {
          const severity: DosingFinding['severity'] = applicable.contraindicated ? 'CRITICAL' : 'HIGH';

          // Compute concrete dose math when the patient's MedicationRequest
          // contains a parseable dosageInstruction. We look up the matching
          // request in patientContext.medications by drug-name stem (matches
          // the same logic used elsewhere in the tools).
          const stem = med.toLowerCase().split(' ')[0];
          const medReq = (patientContext.medications ?? []).find(m => {
            const text = (m.medicationCodeableConcept?.text ?? '').toLowerCase();
            return text.includes(stem);
          });
          const actualDailyDose = medReq ? extractDailyDose(medReq) : undefined;
          const dailyMaxMg = parseDailyMaxFromRecommendation(applicable.recommendation);
          const recommendedDailyMaxAtEgfr = dailyMaxMg !== undefined
            ? { value: dailyMaxMg, unit: 'mg' }
            : undefined;

          // Build a concrete finding string when both numbers are available;
          // fall back to the legacy vague wording otherwise.
          let findingText = `RENAL DOSE ALERT: ${med} requires attention at eGFR ${patientContext.egfr} mL/min`;
          if (actualDailyDose && recommendedDailyMaxAtEgfr) {
            const exceeds = actualDailyDose.value > recommendedDailyMaxAtEgfr.value;
            const verb = exceeds ? 'EXCEEDS' : 'within';
            findingText = `RENAL DOSE ALERT: ${med} actual ${actualDailyDose.value}${actualDailyDose.unit}/day ${verb} renal-adjusted ceiling ${recommendedDailyMaxAtEgfr.value}${recommendedDailyMaxAtEgfr.unit}/day at eGFR ${patientContext.egfr} mL/min`;
          }

          findings.push({
            finding: findingText,
            severity,
            medication: med,
            patientEgfr: patientContext.egfr,
            egfrSource: 'FHIR Observation (LOINC: 33914-3)',
            threshold: `eGFR threshold: ${applicable.egfrRange.min ?? 0}-${applicable.egfrRange.max ?? '∞'} mL/min`,
            recommendation: applicable.recommendation,
            source: applicable.source,
            actualDailyDose,
            recommendedDailyMaxAtEgfr,
          });
        }
      }
    }

    // Hepatic dosing check
    if (patientContext.alt !== undefined || patientContext.ast !== undefined || patientContext.bilirubin !== undefined) {
      const hepaticEntry = matchDrugToDosingKB(med, hepaticDosing);
      if (hepaticEntry) {
        const hepaticAssessment = assessHepaticRisk(patientContext);

        // Only flag if assessment indicates B or C (any meaningful impairment)
        if (hepaticAssessment.category && hepaticAssessment.category !== 'A') {
          const hepaticRec = hepaticEntry.childPughCategories.find(c => c.category === hepaticAssessment.category);

          if (hepaticRec && !hepaticRec.recommendation.startsWith('Standard') && !hepaticRec.recommendation.startsWith('No significant')) {
            findings.push({
              finding: `HEPATIC DOSE ALERT: ${med} may require adjustment — ${hepaticAssessment.label} ${hepaticAssessment.category}`,
              severity: hepaticEntry.contraindicated ? 'HIGH' : 'MODERATE',
              medication: med,
              threshold: `${hepaticAssessment.label} ${hepaticAssessment.category} — ${hepaticAssessment.basis}${hepaticAssessment.disclaimer ? ' (' + hepaticAssessment.disclaimer + ')' : ''}`,
              recommendation: hepaticRec.recommendation,
              source: hepaticRec.source,
            });
          }
        }
      }
    }
  }

  return findings;
}

const SEVERITY_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, MODERATE: 2, LOW: 3, INFO: 4 };

export async function checkOrganFunctionDosing(input: {
  medications: string[];
  patientContext?: PatientContext | null;
  fhirContext?: FHIRContextHeaders;
}): Promise<DosingFinding[]> {
  const { medications, patientContext = null } = input;

  if (!medications || medications.length === 0) return [];

  const { renalDosing, hepaticDosing } = loadDosingKB();

  // Match medications to KB
  const matchedRenal = medications
    .map(med => matchDrugToDosingKB(med, renalDosing))
    .filter((m): m is RenalDosingEntry => m !== undefined);

  const matchedHepatic = medications
    .map(med => matchDrugToDosingKB(med, hepaticDosing))
    .filter((m): m is HepaticDosingEntry => m !== undefined);

  // Run algorithmic detection first
  const algorithmicFindings = detectAlgorithmicDosingIssues(
    medications, renalDosing, hepaticDosing, patientContext
  );

  // If no patient context, skip LLM
  if (!patientContext || (patientContext.egfr === undefined && patientContext.alt === undefined)) {
    return algorithmicFindings;
  }

  // Build prompt
  const { systemPrompt, userPrompt } = buildDosingPrompt(
    medications, matchedRenal, matchedHepatic, patientContext
  );

  const sanitizedPrompt = ensureNoFHIRCredentials(userPrompt);
  const llmResponse = await analyzeWithGemini(systemPrompt, sanitizedPrompt);

  let llmFindings: DosingFinding[] = [];
  if (llmResponse && !llmResponse.includes('LLM analysis unavailable')) {
    try {
      const match = llmResponse.match(/\[[\s\S]*\]/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed)) {
          llmFindings = parsed as DosingFinding[];
        }
      }
    } catch {
      console.error('[dosing] Failed to parse LLM response, using algorithmic findings');
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

  // Backfill source on any LLM-parsed finding that didn't include one — schema requires it.
  for (const f of findings) {
    if (!f.source || typeof f.source !== 'string' || f.source.trim() === '') {
      f.source = 'Gemini organ-function dosing analysis grounded on FDA renal/hepatic dosing KB';
    }
  }

  return findings.sort((a, b) =>
    (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99)
  );
}
