import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { CascadeFinding, DrugKBEntry, PatientContext, CascadeChainStep } from '../../types/clinical.js';
import type { FHIRContextHeaders } from '../../types/mcp.js';
import { analyzeWithGemini } from '../../llm/gemini.js';
import { validateClinicalOutput, ensureNoFHIRCredentials } from '../../llm/guardrails.js';
import { buildCascadePrompt } from '../prompts/cascade-prompt.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const KB_DIR = join(__dirname, '../../knowledge-base');

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
  return { substrates, inhibitors, inducers };
}

function normalizeDrugName(name: string): string {
  return name.toLowerCase().trim().replace(/\s*\d+\s*(mg|mcg|ml|mEq|g)\s*(daily|bid|tid|once|twice|three times)?.*/i, '').trim();
}

function matchDrugToKB<T extends { drug: string; rxnormCui: string }>(
  name: string,
  kb: T[]
): T | undefined {
  const normalized = normalizeDrugName(name);
  return kb.find(entry =>
    entry.drug.toLowerCase() === normalized ||
    entry.drug.toLowerCase().startsWith(normalized) ||
    normalized.startsWith(entry.drug.toLowerCase())
  );
}

function detectAlgorithmicCascades(
  medications: string[],
  substrates: DrugKBEntry[],
  inhibitors: InhibitorEntry[],
  inducers: InducerEntry[],
  patientContext: PatientContext | null
): CascadeFinding[] {
  const findings: CascadeFinding[] = [];

  // Match medications to KB
  const medMatches = medications.map(med => ({
    name: med,
    normalized: normalizeDrugName(med),
    substrate: matchDrugToKB(med, substrates),
    inhibitor: matchDrugToKB(med, inhibitors),
    inducer: matchDrugToKB(med, inducers),
  }));

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

        // Determine severity
        let severity: CascadeFinding['severity'] = 'LOW';
        if (isStrongInhibitor && isMajorSubstrate) {
          severity = patientContext?.egfr !== undefined && patientContext.egfr < 30 ? 'CRITICAL' : 'HIGH';
        } else if (isStrongInhibitor || (isModerateInhibitor && isMajorSubstrate)) {
          severity = 'MODERATE';
        }

        // Build evidence chain
        const chain: CascadeChainStep[] = [
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

        if (patientContext?.egfr !== undefined && patientContext.egfr < 30) {
          chain.push({
            step: 4,
            fact: `Patient eGFR of ${patientContext.egfr} mL/min indicates CKD Stage 4, further impairing ${substrateMed.name} clearance and amplifying accumulation risk`,
            source: 'FHIR Observation (eGFR)',
          });
        }

        const finding: CascadeFinding = {
          finding: `${enzyme} INHIBITION CASCADE: ${inhibitorMed.name} → ↑${substrateMed.name} levels`,
          severity,
          chain,
          clinicalConsequence: `Elevated ${substrateMed.name} plasma levels due to ${enzyme} inhibition by ${inhibitorMed.name}. Risk of ${substrateMed.name}-associated toxicity.`,
          recommendation: `Monitor for ${substrateMed.name} toxicity. Consider reducing ${substrateMed.name} dose or switching to an alternative not metabolized by ${enzyme}.`,
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
  const { substrates, inhibitors, inducers } = loadKB();

  // Match meds to KB
  const kbMatches = medications
    .map(med => matchDrugToKB(med, substrates))
    .filter((m): m is DrugKBEntry => m !== undefined);

  // Identify drugs not in KB
  const unknownDrugs = medications.filter(med => !matchDrugToKB(med, substrates));

  // Run algorithmic pre-filter (deterministic, no LLM)
  const algorithmicFindings = detectAlgorithmicCascades(
    medications, substrates, inhibitors, inducers, patientContext
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

  // Use LLM findings if available and non-empty, otherwise fall back to algorithmic
  const findings = llmFindings.length > 0 ? llmFindings : algorithmicFindings;

  // Add manual review flags for unknown drugs
  if (unknownDrugs.length > 0) {
    findings.push({
      finding: `MANUAL REVIEW REQUIRED: ${unknownDrugs.join(', ')} not found in CYP450 knowledge base`,
      severity: 'INFO',
      chain: [],
      clinicalConsequence: 'Cannot assess CYP450 interactions for these medications without knowledge base data.',
      recommendation: 'Consult clinical pharmacology resources for these medications.',
    });
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
