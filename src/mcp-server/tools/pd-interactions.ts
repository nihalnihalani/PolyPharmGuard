import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { PDFinding, PDInteractionEntry, PatientContext } from '../../types/clinical.js';
import type { FHIRContextHeaders } from '../../types/mcp.js';
import { analyzeWithGemini } from '../../llm/gemini.js';
import { ensureNoFHIRCredentials } from '../../llm/guardrails.js';
import { buildPDPrompt } from '../prompts/pd-prompt.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const KB_PATH = join(__dirname, '../../knowledge-base/pd-interactions.json');

function loadPDKB(): PDInteractionEntry[] {
  return JSON.parse(readFileSync(KB_PATH, 'utf-8'));
}

function normalizeDrug(name: string): string {
  return name.toLowerCase().trim().replace(/\s*\d+\s*(mg|mcg|ml|meq|g)\s*(daily|bid|tid|once|twice|three times)?.*/i, '').trim();
}

function matchDrugsToPDEntries(medications: string[], kb: PDInteractionEntry[]): PDInteractionEntry[] {
  const normalizedMeds = medications.map(normalizeDrug);
  return kb.filter(entry =>
    entry.specificDrugs.some(d => normalizedMeds.some(m => m.includes(d) || d.includes(m)))
  );
}

// Drug-class membership tables. Used to detect specific pair combinations
// inside a PD class so we can generate pair-specific wording instead of a
// generic "BLEEDING_RISK ACCUMULATION" finding. Names are lowercased and
// matched as substrings against the normalized medication list.
const SSRIS = ['sertraline', 'fluoxetine', 'paroxetine', 'citalopram', 'escitalopram', 'fluvoxamine'];
const DAPT_ANTIPLATELETS = ['clopidogrel', 'prasugrel', 'ticagrelor', 'aspirin'];
const ANTICOAGULANTS = ['warfarin', 'apixaban', 'rivaroxaban', 'dabigatran', 'edoxaban'];
const NSAIDS = ['ibuprofen', 'naproxen', 'diclofenac', 'indomethacin', 'ketorolac', 'celecoxib', 'meloxicam', 'piroxicam'];
const QT_PROLONGERS = ['amiodarone', 'sotalol', 'azithromycin', 'ondansetron', 'haloperidol', 'citalopram', 'escitalopram', 'methadone', 'quetiapine', 'ciprofloxacin', 'levofloxacin', 'moxifloxacin'];

function intersects(matchedDrugs: string[], classList: string[]): string[] {
  const lowered = matchedDrugs.map(d => d.toLowerCase());
  return classList.filter(c => lowered.some(m => m.includes(c) || c.includes(m)));
}

interface PairWording {
  finding: string;
  consequence: string;
  recommendation: string;
}

/**
 * Pair-specific wording for known clinical scenarios. Returns null when no
 * specific pair pattern matches — caller falls back to the generic class
 * wording. Adding a new pair requires:
 *   1. The contributing drugs are detectable via the class membership tables
 *      above OR via direct substring match.
 *   2. Tests in tests/tools/pd-interactions.test.ts assert the specific
 *      finding string emerges for the matched drugs (not a generic one).
 */
function specificPairWording(
  pdClass: string,
  matchedDrugs: string[]
): PairWording | null {
  const ssris = intersects(matchedDrugs, SSRIS);
  const antiplatelets = intersects(matchedDrugs, DAPT_ANTIPLATELETS);
  const anticoags = intersects(matchedDrugs, ANTICOAGULANTS);
  const nsaids = intersects(matchedDrugs, NSAIDS);

  if (pdClass === 'BLEEDING_RISK') {
    // Triple antithrombotic = anticoagulant + ≥2 antiplatelets, OR all three classes co-firing
    if (anticoags.length > 0 && antiplatelets.length >= 2) {
      return {
        finding: `TRIPLE ANTITHROMBOTIC BLEEDING RISK: ${[...anticoags, ...antiplatelets].join(' + ')}`,
        consequence: `Concurrent anticoagulant + dual antiplatelet therapy. Major bleeding risk is multiplicative — case series report 2-4x baseline annual major-bleed incidence vs DAPT alone, vs ~1.5x for dual therapy. Particularly hazardous in age >75, low body weight, or recent GI bleed.`,
        recommendation: `Reassess anticoagulation indication and DAPT duration urgently. If post-DES + AFib, follow PIONEER-AF / RE-DUAL PCI / AUGUSTUS guidance: typically drop aspirin first, retain DOAC + clopidogrel for 1–12 months. PPI cover.`,
      };
    }
    // Dual: anticoagulant + 1 antiplatelet
    if (anticoags.length > 0 && antiplatelets.length >= 1) {
      return {
        finding: `DUAL ANTITHROMBOTIC BLEEDING RISK: ${[...anticoags, ...antiplatelets].join(' + ')}`,
        consequence: `Anticoagulant + antiplatelet combination raises major bleeding incidence by 60–80% vs antiplatelet alone (HASBLED literature). Risk concentrates in GI tract for aspirin pairs and ICH for warfarin pairs.`,
        recommendation: `Confirm both agents are still indicated. If chronic AFib + stable CAD, consider monotherapy anticoagulation per AFIRE trial. Add PPI when GI risk factors present.`,
      };
    }
    // SSRI + DAPT — separate platelet-serotonin mechanism
    if (ssris.length > 0 && antiplatelets.length >= 1) {
      return {
        finding: `SSRI + ANTIPLATELET BLEEDING RISK: ${[...ssris, ...antiplatelets].join(' + ')}`,
        consequence: `SSRIs deplete platelet serotonin, impairing platelet aggregation. Stacked on antiplatelet therapy this elevates abnormal-bleeding incidence ~40% vs antiplatelet alone (Anglin et al. 2014, BMJ). GI bleeding is the dominant phenotype.`,
        recommendation: `Switch SSRI to a non-serotonergic agent (mirtazapine, bupropion) when both indications are firm. If SSRI must continue, add PPI cover and monitor for GI symptoms.`,
      };
    }
    // NSAID + anticoagulant
    if (nsaids.length > 0 && anticoags.length > 0) {
      return {
        finding: `NSAID + ANTICOAGULANT BLEEDING RISK: ${[...nsaids, ...anticoags].join(' + ')}`,
        consequence: `NSAIDs add antiplatelet effect plus gastric mucosal injury on top of systemic anticoagulation. RR for major GI bleed ~4× vs anticoagulant alone (Lanas/Schmidt cohorts).`,
        recommendation: `Avoid scheduled NSAID. If unavoidable, prefer the lowest-COX-2-selective option at the lowest dose for the shortest course, with PPI cover. Substitute acetaminophen for analgesia where possible.`,
      };
    }
    // NSAID + antiplatelet
    if (nsaids.length > 0 && antiplatelets.length > 0) {
      return {
        finding: `NSAID + ANTIPLATELET BLEEDING RISK: ${[...nsaids, ...antiplatelets].join(' + ')}`,
        consequence: `Compounded antiplatelet effect plus mucosal injury. Doubles GI bleed incidence vs antiplatelet alone in observational data.`,
        recommendation: `Avoid scheduled NSAID. If pain control requires it, use lowest dose and shortest course with PPI cover.`,
      };
    }
  }

  if (pdClass === 'QT_PROLONGATION') {
    const qtAgents = intersects(matchedDrugs, QT_PROLONGERS);
    if (qtAgents.length >= 2) {
      return {
        finding: `CUMULATIVE QT PROLONGATION: ${qtAgents.join(' + ')}`,
        consequence: `Multiple QT-prolonging agents stacked. Risk of Torsades de Pointes is non-linear; population-level CredibleMeds risk score escalates sharply at ≥2 known TdP-risk drugs. Higher hazard with hypokalemia, hypomagnesemia, age >65, or congestive heart failure.`,
        recommendation: `Obtain baseline ECG and electrolytes (K+ ≥4.0, Mg2+ ≥2.0). Discontinue or substitute the lowest-priority agent. Monitor QTc daily on telemetry while both agents overlap; threshold for action QTc >500ms or >60ms above baseline.`,
      };
    }
  }

  // No specific pair — caller falls back to the generic class wording.
  return null;
}

function detectAlgorithmicPDInteractions(
  medications: string[],
  kb: PDInteractionEntry[]
): PDFinding[] {
  const findings: PDFinding[] = [];
  const normalizedMeds = medications.map(normalizeDrug);

  // Group matched entries by PD class
  const classBuckets = new Map<string, { entries: PDInteractionEntry[]; matchedDrugs: string[] }>();

  for (const entry of kb) {
    const matchedDrugs = entry.specificDrugs.filter(d =>
      normalizedMeds.some(m => m.includes(d) || d.includes(m))
    );
    if (matchedDrugs.length === 0) continue;

    if (!classBuckets.has(entry.class)) {
      classBuckets.set(entry.class, { entries: [], matchedDrugs: [] });
    }
    const bucket = classBuckets.get(entry.class)!;
    bucket.entries.push(entry);
    bucket.matchedDrugs.push(...matchedDrugs.filter(d => !bucket.matchedDrugs.includes(d)));
  }

  // Generate findings for classes with 2+ contributing drug classes
  for (const [pdClass, bucket] of classBuckets.entries()) {
    if (bucket.entries.length < 2) continue;

    const highestSeverityEntry = bucket.entries.reduce((a, b) =>
      ['CRITICAL', 'HIGH', 'MODERATE', 'LOW'].indexOf(a.severity) <
      ['CRITICAL', 'HIGH', 'MODERATE', 'LOW'].indexOf(b.severity) ? a : b
    );

    const riskScore = bucket.entries.reduce((sum, e) => sum + e.riskScoreWeight, 0);
    const severity = riskScore >= 7 ? 'CRITICAL' : riskScore >= 5 ? 'HIGH' : riskScore >= 3 ? 'MODERATE' : 'LOW';

    // Try the pair-specific wording table first; fall back to generic class
    // wording only when no specific scenario matches.
    const pairWording = specificPairWording(pdClass, bucket.matchedDrugs);
    const finding = pairWording?.finding
      ?? `${pdClass.replace('_', ' ')} ACCUMULATION: ${bucket.matchedDrugs.join(' + ')}`;
    const consequence = pairWording?.consequence ?? highestSeverityEntry.consequence;
    const recommendation = pairWording?.recommendation
      ?? `Review ${pdClass.replace('_', ' ').toLowerCase()} risk. Consider tapering or discontinuing the lowest-priority agent.`;

    findings.push({
      finding,
      severity: severity as PDFinding['severity'],
      class: pdClass as PDFinding['class'],
      contributingDrugs: bucket.matchedDrugs,
      mechanism: highestSeverityEntry.mechanism,
      clinicalConsequence: consequence,
      recommendation,
      riskScore,
      source: bucket.entries.map(e => e.source).join('; '),
    });
  }

  return findings;
}

const SEVERITY_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, MODERATE: 2, LOW: 3 };

export async function analyzePDInteractions(input: {
  medications: string[];
  patientContext?: PatientContext | null;
  fhirContext?: FHIRContextHeaders;
}): Promise<PDFinding[]> {
  const { medications, patientContext = null } = input;
  if (!medications || medications.length === 0) return [];

  const kb = loadPDKB();
  const relevantEntries = matchDrugsToPDEntries(medications, kb);
  const algorithmicFindings = detectAlgorithmicPDInteractions(medications, relevantEntries);

  if (relevantEntries.length === 0) return algorithmicFindings;

  const { systemPrompt, userPrompt } = buildPDPrompt(medications, relevantEntries, patientContext);
  const sanitized = ensureNoFHIRCredentials(userPrompt);

  let llmFindings: PDFinding[] = [];
  try {
    const response = await analyzeWithGemini(systemPrompt, sanitized);
    if (response && !response.includes('LLM analysis unavailable')) {
      const match = response.match(/\[[\s\S]*\]/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed)) llmFindings = parsed as PDFinding[];
      }
    }
  } catch {
    console.error('[pd-interactions] LLM parse failed, using algorithmic findings');
  }

  // Use algorithmic findings as ground truth; LLM findings supplement (never replace)
  const merged = [...algorithmicFindings];
  for (const llmFinding of llmFindings) {
    const isDuplicate = algorithmicFindings.some(af =>
      af.finding.toLowerCase().includes(llmFinding.finding.toLowerCase().split(':')[0].toLowerCase()) ||
      llmFinding.finding.toLowerCase().includes(af.finding.toLowerCase().split(':')[0].toLowerCase())
    );
    if (!isDuplicate) merged.push(llmFinding);
  }
  return merged.sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99));
}
