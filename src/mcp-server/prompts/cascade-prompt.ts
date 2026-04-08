import type { DrugKBEntry, PatientContext } from '../../types/clinical.js';

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

export function buildCascadePrompt(
  medications: string[],
  kbMatches: DrugKBEntry[],
  inhibitors: InhibitorEntry[],
  inducers: InducerEntry[],
  patientContext: PatientContext | null
): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = `You are a clinical pharmacology expert specializing in cytochrome P450 (CYP450) pharmacokinetic drug interactions.

STRICT RULES — You MUST follow these without exception:
1. ONLY cite facts from the KNOWLEDGE BASE DATA section provided below. Do NOT use your training knowledge for drug interaction claims.
2. Every factual claim about a drug interaction MUST include [source: <citation>] at the end of the statement.
3. If you are uncertain about any CYP450 relationship not present in the KB data, state "REQUIRES MANUAL REVIEW — not in knowledge base" rather than guessing.
4. Output ONLY a valid JSON array of findings. No prose, no markdown, no explanation outside the JSON.
5. Each finding must have these exact fields: finding (string), severity ("CRITICAL"|"HIGH"|"MODERATE"|"LOW"), chain (array of {step: number, fact: string, source: string}), clinicalConsequence (string), recommendation (string), and optionally faersSignal (string).
6. Severity criteria: CRITICAL = life-threatening without immediate intervention; HIGH = significant harm likely; MODERATE = requires monitoring; LOW = minor clinical significance.
7. A CRITICAL finding MUST have at least 2 cited steps in its chain.`;

  const medicationSection = medications
    .map((m, i) => `${i + 1}. ${m}`)
    .join('\n');

  const kbSection = kbMatches.length > 0
    ? kbMatches.map(entry => {
        const inhibitor = inhibitors.find(i => i.drug === entry.drug || i.rxnormCui === entry.rxnormCui);
        const inducer = inducers.find(i => i.drug === entry.drug || i.rxnormCui === entry.rxnormCui);

        let kbText = `Drug: ${entry.drug} (RxNorm: ${entry.rxnormCui})\n`;

        if (entry.cypRelationships.length > 0) {
          kbText += '  CYP Substrate Relationships:\n';
          for (const rel of entry.cypRelationships) {
            kbText += `    - ${rel.enzyme} ${rel.role} [source: ${rel.source}]\n`;
          }
        } else {
          kbText += '  CYP Substrate Relationships: Not significantly CYP-metabolized\n';
        }

        if (inhibitor && inhibitor.inhibitions.length > 0) {
          kbText += '  CYP Inhibitor Activity:\n';
          for (const inh of inhibitor.inhibitions) {
            kbText += `    - ${inh.enzyme} ${inh.strength} [source: ${inh.source}]\n`;
          }
        }

        if (inducer && inducer.inductions.length > 0) {
          kbText += '  CYP Inducer Activity:\n';
          for (const ind of inducer.inductions) {
            kbText += `    - ${ind.enzyme} ${ind.strength} [source: ${ind.source}]\n`;
          }
        }

        return kbText;
      }).join('\n')
    : 'No CYP450 data found for any of the provided medications.';

  const contextSection = patientContext
    ? `Patient Age: ${patientContext.age ?? 'Unknown'} years
eGFR: ${patientContext.egfr ?? 'NOT AVAILABLE'} mL/min/1.73m2${patientContext.egfr ? ` (${patientContext.egfr < 30 ? 'CKD Stage 4-5 — severely impaired renal clearance' : patientContext.egfr < 60 ? 'CKD Stage 3 — moderately impaired renal clearance' : 'Normal/near-normal renal function'})` : ''}
ALT: ${patientContext.alt ?? 'NOT AVAILABLE'} U/L
AST: ${patientContext.ast ?? 'NOT AVAILABLE'} U/L
Total Bilirubin: ${patientContext.bilirubin ?? 'NOT AVAILABLE'} mg/dL
Active Conditions: ${patientContext.conditions.map(c => c.code?.coding?.[0]?.display ?? c.code?.text ?? 'Unknown condition').join(', ') || 'None documented'}`
    : 'Patient context not available. Analyze based on knowledge base data only.';

  const userPrompt = `PATIENT MEDICATIONS (complete list):
${medicationSection}

KNOWLEDGE BASE DATA (FDA CYP450 Drug Interaction Tables 2024):
${kbSection}

PATIENT CLINICAL CONTEXT:
${contextSection}

TASK: Analyze the above medication list for multi-drug CYP450 pharmacokinetic cascade interactions. Focus on:
1. Enzyme inhibition chains: Drug A inhibits enzyme E → Drug B (substrate of E) accumulates → elevated levels cause clinical harm
2. Three-drug cascades where the accumulation of Drug B also affects Drug C
3. How the patient's organ function amplifies interaction severity (e.g., reduced renal clearance of a CYP substrate already elevated by an inhibitor)
4. Interactions that standard pairwise checkers would miss (3+ drug cascades)

Return ONLY a JSON array of findings. Do not include interactions not supported by the KB data above. If no interactions are found, return [].`;

  return { systemPrompt, userPrompt };
}
