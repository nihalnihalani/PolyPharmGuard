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

function detectAlgorithmicPDInteractions(
  medications: string[],
  kb: PDInteractionEntry[],
  patientContext: PatientContext | null
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

    findings.push({
      finding: `${pdClass.replace('_', ' ')} ACCUMULATION: ${bucket.matchedDrugs.join(' + ')}`,
      severity: severity as PDFinding['severity'],
      class: pdClass as PDFinding['class'],
      contributingDrugs: bucket.matchedDrugs,
      mechanism: highestSeverityEntry.mechanism,
      clinicalConsequence: highestSeverityEntry.consequence,
      recommendation: `Review ${pdClass.replace('_', ' ').toLowerCase()} risk. Consider tapering or discontinuing the lowest-priority agent.`,
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
  const algorithmicFindings = detectAlgorithmicPDInteractions(medications, relevantEntries, patientContext);

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
