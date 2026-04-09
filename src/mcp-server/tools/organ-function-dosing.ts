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

function matchDrugToDosingKB<T extends { drug: string }>(name: string, kb: T[]): T | undefined {
  const normalized = normalizeDrugName(name);
  return kb.find(entry =>
    entry.drug.toLowerCase() === normalized ||
    entry.drug.toLowerCase().startsWith(normalized) ||
    normalized.startsWith(entry.drug.toLowerCase())
  );
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
          findings.push({
            finding: `RENAL DOSE ALERT: ${med} requires attention at eGFR ${patientContext.egfr} mL/min`,
            severity,
            medication: med,
            patientEgfr: patientContext.egfr,
            egfrSource: 'FHIR Observation (LOINC: 33914-3)',
            threshold: `eGFR threshold: ${applicable.egfrRange.min ?? 0}-${applicable.egfrRange.max ?? '∞'} mL/min`,
            recommendation: applicable.recommendation,
          });
        }
      }
    }

    // Hepatic dosing check
    if (patientContext.alt !== undefined || patientContext.ast !== undefined || patientContext.bilirubin !== undefined) {
      const hepaticEntry = matchDrugToDosingKB(med, hepaticDosing);
      if (hepaticEntry) {
        // Simple heuristic: ALT > 3x ULN (>120) or bilirubin > 2x ULN (>2.0) suggests significant hepatic impairment
        const alt = patientContext.alt ?? 0;
        const bilirubin = patientContext.bilirubin ?? 0;

        if (alt > 120 || bilirubin > 2.0) {
          const childPughCategory = bilirubin > 3.0 || alt > 200 ? 'C' : bilirubin > 2.0 || alt > 120 ? 'B' : 'A';
          const hepaticRec = hepaticEntry.childPughCategories.find(c => c.category === childPughCategory);

          if (hepaticRec && !hepaticRec.recommendation.startsWith('Standard') && !hepaticRec.recommendation.startsWith('No significant')) {
            findings.push({
              finding: `HEPATIC DOSE ALERT: ${med} may require adjustment given elevated liver enzymes`,
              severity: hepaticEntry.contraindicated ? 'HIGH' : 'MODERATE',
              medication: med,
              threshold: `Child-Pugh ${childPughCategory} (ALT: ${patientContext.alt}, Bilirubin: ${patientContext.bilirubin})`,
              recommendation: hepaticRec.recommendation,
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

  return findings.sort((a, b) =>
    (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99)
  );
}
