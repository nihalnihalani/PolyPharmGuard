import type { PatientContext } from '../../types/clinical.js';

interface BeersEntry {
  drug: string;
  drugClass: string;
  category: string;
  recommendation: string;
  rationale: string;
  qualityOfEvidence: string;
  strengthOfRecommendation: string;
  ageThreshold: number;
  source: string;
}

interface STOPPFrailEntry {
  criterion: string;
  drugs: string[];
  drugClass: string;
  recommendation: string;
  rationale: string;
  source: string;
}

export function buildDeprescribingPrompt(
  medications: string[],
  beersCriteria: BeersEntry[],
  stoppfrailCriteria: STOPPFrailEntry[],
  patientContext: PatientContext | null,
  patientAge?: number
): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = `You are a geriatric clinical pharmacist specializing in evidence-based deprescribing in older adults.

STRICT RULES:
1. ONLY cite criteria from the BEERS CRITERIA and STOPPFRAIL sections provided. Do not use training knowledge for specific deprescribing recommendations.
2. Every recommendation MUST cite the guideline source [source: <citation>].
3. Output ONLY a valid JSON array of findings.
4. Each finding must have: finding (string), severity ("HIGH"|"MODERATE"|"LOW"), medication (string), duration (string if known), indicationStatus (string), guideline (string), beersFlag (string or null), stoppfrailFlag (string or null), taperPlan (array of {week: number, dose: string} or null).
5. Only recommend deprescribing if there is no documented clinical indication for the medication in the patient's condition list, OR if the patient meets age/duration criteria from the guidelines.
6. If a medication has a clear documented indication, do NOT recommend discontinuation.`;

  const age = patientAge ?? patientContext?.age;
  const conditions = patientContext?.conditions
    .map(c => c.code?.coding?.[0]?.display ?? c.code?.text ?? 'Unknown')
    .join(', ') ?? 'None documented';

  const medsWithDuration = medications.map((med, i) => {
    const medReq = patientContext?.medications[i];
    let duration = '';
    if (medReq?.authoredOn) {
      const start = new Date(medReq.authoredOn);
      const now = new Date();
      const weeks = Math.floor((now.getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000));
      duration = ` (prescribed ${weeks} weeks ago, since ${medReq.authoredOn})`;
    }
    return `${i + 1}. ${med}${duration}`;
  }).join('\n');

  const beersSection = beersCriteria.length > 0
    ? beersCriteria.map(e =>
        `Drug/Class: ${e.drug} (${e.drugClass})\n  Category: ${e.category}\n  Recommendation: ${e.recommendation}\n  Rationale: ${e.rationale}\n  Evidence: ${e.qualityOfEvidence} quality, ${e.strengthOfRecommendation} recommendation\n  Age Threshold: >=${e.ageThreshold} years\n  Source: ${e.source}`
      ).join('\n\n')
    : 'No Beers Criteria matches found for current medications.';

  const stoppSection = stoppfrailCriteria.length > 0
    ? stoppfrailCriteria.map(e =>
        `Criterion: ${e.criterion} — ${e.drugClass}\n  Applicable drugs: ${e.drugs.join(', ')}\n  Recommendation: ${e.recommendation}\n  Rationale: ${e.rationale}\n  Source: ${e.source}`
      ).join('\n\n')
    : 'No STOPPFrail criteria matches found for current medications.';

  const userPrompt = `PATIENT DEMOGRAPHICS:
- Age: ${age ?? 'Unknown'} years
- Active Conditions: ${conditions}
- Medications (with duration):
${medsWithDuration}

BEERS CRITERIA 2023 MATCHES (for current medications):
${beersSection}

STOPPFRAIL CRITERIA MATCHES (for current medications):
${stoppSection}

TASK: Screen the medication list for deprescribing candidates. Prioritize by:
1. Medications meeting BOTH Beers and STOPPFrail criteria (highest priority)
2. Medications with NO documented indication in the conditions list
3. Medications exceeding recommended duration (e.g., PPIs >8 weeks without documented GI indication)

For each candidate, generate a safe taper plan. Return a JSON array of findings. Return [] if no deprescribing is recommended.`;

  return { systemPrompt, userPrompt };
}
