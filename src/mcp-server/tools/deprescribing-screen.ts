import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { DeprescribingFinding, TaperStep, PatientContext } from '../../types/clinical.js';
import type { FHIRContextHeaders } from '../../types/mcp.js';
import { analyzeWithGemini } from '../../llm/gemini.js';
import { ensureNoFHIRCredentials } from '../../llm/guardrails.js';
import { buildDeprescribingPrompt } from '../prompts/deprescribing-prompt.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const KB_DIR = join(__dirname, '../../knowledge-base');

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

function loadDeprescribingKB(): { beersCriteria: BeersEntry[]; stoppfrailCriteria: STOPPFrailEntry[] } {
  const beersCriteria: BeersEntry[] = JSON.parse(
    readFileSync(join(KB_DIR, 'beers-criteria.json'), 'utf-8')
  );
  const stoppfrailCriteria: STOPPFrailEntry[] = JSON.parse(
    readFileSync(join(KB_DIR, 'stoppfrail.json'), 'utf-8')
  );
  return { beersCriteria, stoppfrailCriteria };
}

function normalizeDrugName(name: string): string {
  return name.toLowerCase().trim().replace(/\s*\d+\s*(mg|mcg|ml|mEq|g)\s*(daily|bid|tid|once|twice|three times)?.*/i, '').trim();
}

function matchBeers(drugName: string, criteria: BeersEntry[]): BeersEntry | undefined {
  const normalized = normalizeDrugName(drugName);
  return criteria.find(c =>
    c.drug.toLowerCase() === normalized ||
    c.drug.toLowerCase().startsWith(normalized) ||
    normalized.startsWith(c.drug.toLowerCase())
  );
}

function matchSTOPPFrail(drugName: string, criteria: STOPPFrailEntry[]): STOPPFrailEntry | undefined {
  const normalized = normalizeDrugName(drugName);
  return criteria.find(c =>
    c.drugs.some(d => d.toLowerCase() === normalized || normalized.startsWith(d.toLowerCase()) || d.toLowerCase().startsWith(normalized))
  );
}

function getMedicationDurationWeeks(medReq: { authoredOn?: string } | undefined): number | undefined {
  if (!medReq?.authoredOn) return undefined;
  const start = new Date(medReq.authoredOn);
  const now = new Date();
  return Math.floor((now.getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000));
}

function hasDocumentedIndication(drugName: string, conditions: PatientContext['conditions']): { hasIndication: boolean; indication?: string } {
  const normalized = normalizeDrugName(drugName);

  const indicationMap: Record<string, string[]> = {
    'warfarin': ['atrial fibrillation', 'venous thromboembolism', 'dvt', 'pulmonary embolism', 'heart valve'],
    'aspirin': ['atrial fibrillation', 'coronary artery disease', 'myocardial infarction', 'stroke', 'peripheral artery'],
    'metformin': ['diabetes', 'type 2 diabetes'],
    'lisinopril': ['hypertension', 'heart failure', 'chronic kidney disease', 'diabetes'],
    'amlodipine': ['hypertension', 'angina'],
    'metoprolol': ['hypertension', 'heart failure', 'atrial fibrillation', 'coronary artery'],
    'furosemide': ['heart failure', 'edema', 'hypertension', 'chronic kidney disease'],
    'gabapentin': ['neuropathy', 'epilepsy', 'seizure', 'pain'],
    'omeprazole': ['gerd', 'barrett', 'peptic ulcer', 'helicobacter', 'h. pylori', 'nsaid'],
    'simvastatin': ['hyperlipidemia', 'hypercholesterolemia', 'cardiovascular', 'coronary artery', 'diabetes'],
    'fluconazole': ['candida', 'fungal', 'candidiasis'],
    'potassium chloride': ['hypokalemia', 'heart failure', 'diuretic use'],
  };

  const conditionNames = conditions.map(c =>
    [c.code?.coding?.[0]?.display ?? '', c.code?.text ?? ''].join(' ').toLowerCase()
  );

  const indicatorTerms = indicationMap[normalized];
  if (!indicatorTerms) return { hasIndication: false };

  for (const term of indicatorTerms) {
    const matchingCondition = conditionNames.find(cn => cn.includes(term));
    if (matchingCondition) {
      return { hasIndication: true, indication: matchingCondition.trim() };
    }
  }

  return { hasIndication: false };
}

const TAPER_PLANS: Record<string, TaperStep[]> = {
  omeprazole: [
    { week: 1, dose: 'Reduce to Omeprazole 20mg once daily' },
    { week: 2, dose: 'Omeprazole 20mg every other day' },
    { week: 3, dose: 'Omeprazole 20mg every 3rd day; start Famotidine 20mg as needed for rebound symptoms' },
    { week: 4, dose: 'Discontinue Omeprazole. Continue Famotidine 20mg PRN for up to 4 weeks if needed.' },
  ],
  lansoprazole: [
    { week: 1, dose: 'Reduce to Lansoprazole 15mg once daily' },
    { week: 2, dose: 'Lansoprazole 15mg every other day' },
    { week: 3, dose: 'Lansoprazole 15mg every 3rd day; start Famotidine 20mg PRN' },
    { week: 4, dose: 'Discontinue Lansoprazole. Continue Famotidine 20mg PRN.' },
  ],
  pantoprazole: [
    { week: 1, dose: 'Reduce to Pantoprazole 20mg once daily' },
    { week: 2, dose: 'Pantoprazole 20mg every other day' },
    { week: 3, dose: 'Pantoprazole 20mg every 3rd day; start Famotidine 20mg PRN' },
    { week: 4, dose: 'Discontinue Pantoprazole. Continue Famotidine 20mg PRN.' },
  ],
  diazepam: [
    { week: 1, dose: 'Reduce current dose by 25%' },
    { week: 3, dose: 'Reduce by another 25% (50% of original dose)' },
    { week: 5, dose: 'Reduce to 25% of original dose' },
    { week: 7, dose: 'Reduce to 12.5% of original dose; may switch to equivalent Lorazepam for easier dosing' },
    { week: 9, dose: 'Discontinue. Monitor for withdrawal symptoms.' },
  ],
  alprazolam: [
    { week: 1, dose: 'Reduce current dose by 25%' },
    { week: 3, dose: 'Reduce to 50% of original dose' },
    { week: 5, dose: 'Reduce to 25% of original dose' },
    { week: 7, dose: 'Discontinue. Monitor for withdrawal.' },
  ],
};

function getAlgorithmicDeprescribingFindings(
  medications: string[],
  medRequests: { authoredOn?: string }[],
  beersCriteria: BeersEntry[],
  stoppfrailCriteria: STOPPFrailEntry[],
  patientContext: PatientContext | null,
  patientAge?: number
): DeprescribingFinding[] {
  const findings: DeprescribingFinding[] = [];
  const age = patientAge ?? patientContext?.age;
  const conditions = patientContext?.conditions ?? [];

  for (let i = 0; i < medications.length; i++) {
    const med = medications[i];
    const medReq = medRequests[i];
    const normalized = normalizeDrugName(med);

    const beersMatch = age !== undefined && age >= 65 ? matchBeers(med, beersCriteria) : undefined;
    const stoppMatch = matchSTOPPFrail(med, stoppfrailCriteria);
    const durationWeeks = getMedicationDurationWeeks(medReq);
    const { hasIndication, indication } = hasDocumentedIndication(med, conditions);

    let shouldFlag = false;
    let severity: DeprescribingFinding['severity'] = 'LOW';
    let beersFlag: string | undefined;
    let stoppfrailFlag: string | undefined;

    if (beersMatch) {
      if (age !== undefined && age >= beersMatch.ageThreshold) {
        shouldFlag = true;
        severity = 'MODERATE';
        beersFlag = `${beersMatch.source}: ${beersMatch.recommendation}`;
      }
    }

    if (stoppMatch) {
      shouldFlag = true;
      severity = beersMatch ? 'HIGH' : 'MODERATE';
      stoppfrailFlag = `${stoppMatch.source}: ${stoppMatch.recommendation}`;
    }

    // PPI duration check
    if ((normalized === 'omeprazole' || normalized === 'lansoprazole' || normalized === 'pantoprazole') &&
        durationWeeks !== undefined && durationWeeks > 8 && !hasIndication) {
      shouldFlag = true;
      severity = 'HIGH';
    }

    // Warfarin with AFib documented: do NOT flag
    if (normalized === 'warfarin' && hasIndication) {
      shouldFlag = false;
    }

    // Aspirin with CVD/AFib documented and age < 70: do NOT flag
    if (normalized === 'aspirin' && hasIndication && age !== undefined && age < 70) {
      shouldFlag = false;
    }

    if (!shouldFlag) continue;

    const indicationStatus = hasIndication
      ? `Documented indication: ${indication}`
      : 'No documented indication found in FHIR Condition resources';

    const taperPlanKey = Object.keys(TAPER_PLANS).find(k => normalized.startsWith(k) || k.startsWith(normalized));
    const taperPlan = taperPlanKey ? TAPER_PLANS[taperPlanKey] : undefined;

    const durationStr = durationWeeks !== undefined ? `${durationWeeks} weeks` : undefined;

    findings.push({
      finding: `DEPRESCRIBING CANDIDATE: ${med}`,
      severity,
      medication: med,
      duration: durationStr,
      indicationStatus,
      guideline: [
        beersMatch ? `AGS 2023 Beers Criteria: ${beersMatch.recommendation}` : '',
        stoppMatch ? `STOPPFrail: ${stoppMatch.recommendation}` : '',
      ].filter(Boolean).join(' | ') || 'Duration/indication review',
      beersFlag,
      stoppfrailFlag,
      taperPlan,
    });
  }

  return findings;
}

const SEVERITY_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, MODERATE: 2, LOW: 3, INFO: 4 };

export async function screenDeprescribing(input: {
  medications: Array<string | { name?: string; display?: string }> | any[];
  patientContext?: PatientContext | null;
  fhirContext?: FHIRContextHeaders;
  patientAge?: number;
}): Promise<DeprescribingFinding[]> {
  const { patientContext = null, patientAge } = input;

  // Normalize medications: support string[] or FHIRMedicationRequest[]
  const medNames: string[] = [];
  const medRequests: { authoredOn?: string }[] = [];

  if (Array.isArray(input.medications)) {
    for (const med of input.medications) {
      if (typeof med === 'string') {
        medNames.push(med);
        medRequests.push({});
      } else if (med && typeof med === 'object') {
        const fhirMed = med as any;
        const display = fhirMed.medicationCodeableConcept?.coding?.[0]?.display ??
                        fhirMed.medicationCodeableConcept?.text ??
                        fhirMed.name ?? 'Unknown';
        medNames.push(display);
        medRequests.push({ authoredOn: fhirMed.authoredOn });
      }
    }
  }

  if (medNames.length === 0) return [];

  const { beersCriteria, stoppfrailCriteria } = loadDeprescribingKB();

  // Run algorithmic detection
  const algorithmicFindings = getAlgorithmicDeprescribingFindings(
    medNames, medRequests, beersCriteria, stoppfrailCriteria, patientContext, patientAge
  );

  // Match to KB for LLM prompt
  const matchedBeers = medNames
    .map(med => matchBeers(med, beersCriteria))
    .filter((m): m is BeersEntry => m !== undefined);
  const matchedSTOPP = medNames
    .map(med => matchSTOPPFrail(med, stoppfrailCriteria))
    .filter((m): m is STOPPFrailEntry => m !== undefined);

  // Build prompt and call Gemini
  const { systemPrompt, userPrompt } = buildDeprescribingPrompt(
    medNames, matchedBeers, matchedSTOPP, patientContext, patientAge
  );

  const sanitizedPrompt = ensureNoFHIRCredentials(userPrompt);
  const llmResponse = await analyzeWithGemini(systemPrompt, sanitizedPrompt);

  let llmFindings: DeprescribingFinding[] = [];
  if (llmResponse && !llmResponse.includes('LLM analysis unavailable')) {
    try {
      const match = llmResponse.match(/\[[\s\S]*\]/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed)) {
          llmFindings = parsed as DeprescribingFinding[];
        }
      }
    } catch {
      console.error('[deprescribing] Failed to parse LLM response, using algorithmic findings');
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
