import type { PatientContext } from '../../types/clinical.js';
import type { PDInteractionEntry } from '../../types/clinical.js';

export function buildPDPrompt(
  medications: string[],
  relevantEntries: PDInteractionEntry[],
  patientContext: PatientContext | null
): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = `You are a clinical pharmacist specializing in pharmacodynamic (PD) drug interactions. You analyze combinations of medications for additive or synergistic effects at the receptor/physiological level — NOT metabolic (CYP450) interactions.

CRITICAL RULES:
1. Only report interactions grounded in the provided knowledge base entries. Do NOT fabricate interactions.
2. Every finding must cite the source from the KB entry.
3. Focus on CNS depression accumulation, QT prolongation stacking, bleeding risk accumulation, and serotonin syndrome.
4. Consider patient context (age, renal function) when determining severity.
5. Return a JSON array of PDFinding objects only — no prose.`;

  const contextBlock = patientContext
    ? `Patient context: Age ${patientContext.age ?? 'unknown'}, eGFR ${patientContext.egfr ?? 'unknown'} mL/min`
    : 'No patient context available.';

  const userPrompt = `Analyze the following medications for pharmacodynamic interactions using ONLY the knowledge base entries provided.

Medications: ${medications.join(', ')}

${contextBlock}

Relevant KB entries:
${JSON.stringify(relevantEntries, null, 2)}

Return a JSON array of PDFinding objects with this structure:
[{
  "finding": "string — brief title",
  "severity": "CRITICAL|HIGH|MODERATE|LOW",
  "class": "CNS_DEPRESSION|QT_PROLONGATION|BLEEDING_RISK|SEROTONIN_SYNDROME|HYPOTENSION",
  "contributingDrugs": ["array of drug names involved"],
  "mechanism": "string — pharmacodynamic mechanism",
  "clinicalConsequence": "string — what could happen",
  "recommendation": "string — what to do",
  "riskScore": number (1-10),
  "source": "string — KB source citation"
}]

Return [] if no interactions found. Return JSON only.`;

  return { systemPrompt, userPrompt };
}
