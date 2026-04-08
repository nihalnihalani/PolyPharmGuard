import type { PatientContext } from '../../types/clinical.js';

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

export function buildDosingPrompt(
  medications: string[],
  renalData: RenalDosingEntry[],
  hepaticData: HepaticDosingEntry[],
  patientContext: PatientContext | null
): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = `You are a clinical pharmacologist specializing in drug dosing in organ impairment, with expertise in nephrology and hepatology.

STRICT RULES:
1. ONLY cite dosing thresholds from the DOSING DATABASE provided below. Do not use training knowledge for specific dosing recommendations.
2. Every recommendation MUST include [source: <citation>] at the end.
3. If organ function data is not available, state this explicitly.
4. Output ONLY a valid JSON array of findings with fields: finding, severity, medication, patientEgfr (if applicable), egfrSource, threshold, recommendation, alternative (optional).
5. Severity: CRITICAL = contraindicated/immediate risk; HIGH = significant dose adjustment or discontinuation needed; MODERATE = dose adjustment recommended; LOW = monitoring only.`;

  const renalSection = renalData.length > 0
    ? renalData.map(entry => {
        const thresholds = entry.adjustments.map(adj => {
          const rangeStr = adj.egfrRange.min === null ? `eGFR <${adj.egfrRange.max}` :
            adj.egfrRange.max === null ? `eGFR ≥${adj.egfrRange.min}` :
            `eGFR ${adj.egfrRange.min}-${adj.egfrRange.max}`;
          return `  ${rangeStr}: ${adj.recommendation}${adj.contraindicated ? ' [CONTRAINDICATED]' : ''} [source: ${adj.source}]`;
        }).join('\n');
        return `Drug: ${entry.drug} (RxNorm: ${entry.rxnormCui})\n${thresholds}`;
      }).join('\n\n')
    : 'No renal dosing data found for current medications.';

  const hepaticSection = hepaticData.length > 0
    ? hepaticData.map(entry => {
        const categories = entry.childPughCategories.map(c =>
          `  Child-Pugh ${c.category}: ${c.recommendation} [source: ${c.source}]`
        ).join('\n');
        return `Drug: ${entry.drug}${entry.contraindicationNote ? `\n  NOTE: ${entry.contraindicationNote}` : ''}\n${categories}`;
      }).join('\n\n')
    : 'No hepatic dosing data found for current medications.';

  const egfrStatus = patientContext?.egfr !== undefined
    ? `${patientContext.egfr} mL/min/1.73m2 (${patientContext.egfr < 15 ? 'CKD Stage 5' : patientContext.egfr < 30 ? 'CKD Stage 4 — severe' : patientContext.egfr < 45 ? 'CKD Stage 3b' : patientContext.egfr < 60 ? 'CKD Stage 3a' : 'Normal or mildly reduced'})`
    : 'NOT AVAILABLE';

  const userPrompt = `PATIENT MEDICATIONS:
${medications.map((m, i) => `${i + 1}. ${m}`).join('\n')}

PATIENT ORGAN FUNCTION:
- eGFR: ${egfrStatus}
- ALT: ${patientContext?.alt ?? 'NOT AVAILABLE'} U/L
- AST: ${patientContext?.ast ?? 'NOT AVAILABLE'} U/L
- Total Bilirubin: ${patientContext?.bilirubin ?? 'NOT AVAILABLE'} mg/dL
- Patient Age: ${patientContext?.age ?? 'Unknown'} years

RENAL DOSING DATABASE (from FDA labeling):
${renalSection}

HEPATIC DOSING DATABASE (from FDA labeling):
${hepaticSection}

TASK: For each medication, assess whether the current dose is appropriate given the patient's organ function. Use ONLY the dosing data provided above. Report each finding as a JSON object with these fields: finding (string), severity ("CRITICAL"|"HIGH"|"MODERATE"|"LOW"), medication (string), patientEgfr (number if applicable), egfrSource (string), threshold (string describing the relevant threshold), recommendation (string), alternative (string if applicable).

Return an empty array [] if no dosing concerns are found. Do not invent dosing thresholds not present in the database above.`;

  return { systemPrompt, userPrompt };
}
