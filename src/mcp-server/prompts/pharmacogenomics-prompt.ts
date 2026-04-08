import type { PGxEntry } from '../../types/clinical.js';

export function buildPGxPrompt(
  medications: string[],
  genotypes: Record<string, string>,
  relevantEntries: PGxEntry[]
): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = `You are a clinical pharmacogenomics specialist. You interpret how a patient's genetic variants affect drug metabolism and response.

CRITICAL RULES:
1. Only report gene-drug interactions present in the provided KB entries. Do NOT fabricate.
2. Every finding must cite the source from the KB.
3. Return a JSON array of PGxFinding objects only — no prose.`;

  const userPrompt = `Analyze the following medications given the patient's pharmacogenomic profile.

Medications: ${medications.join(', ')}
Patient genotypes: ${JSON.stringify(genotypes)}

Relevant KB entries:
${JSON.stringify(relevantEntries, null, 2)}

Return a JSON array of PGxFinding objects:
[{
  "finding": "string",
  "severity": "CRITICAL|HIGH|MODERATE|LOW",
  "drug": "string",
  "gene": "string",
  "phenotype": "string",
  "consequence": "string",
  "recommendation": "string",
  "source": "string"
}]

Return [] if no actionable interactions. Return JSON only.`;

  return { systemPrompt, userPrompt };
}
