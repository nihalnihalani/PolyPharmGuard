import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { PGxFinding, PGxEntry } from '../../types/clinical.js';
import { analyzeWithGemini } from '../../llm/gemini.js';
import { ensureNoFHIRCredentials } from '../../llm/guardrails.js';
import { buildPGxPrompt } from '../prompts/pharmacogenomics-prompt.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const KB_PATH = join(__dirname, '../../knowledge-base/pharmacogenomics.json');

function loadPGxKB(): PGxEntry[] {
  return JSON.parse(readFileSync(KB_PATH, 'utf-8'));
}

function normalizeDrug(name: string): string {
  return name.toLowerCase().trim().replace(/\s*\d+\s*(mg|mcg|ml|meq|g)\s*(daily|bid|tid|once|twice|three times)?.*/i, '').trim();
}

function findMatchingEntries(
  medications: string[],
  genotypes: Record<string, string>,
  kb: PGxEntry[]
): PGxEntry[] {
  if (Object.keys(genotypes).length === 0) return [];
  const normalizedMeds = medications.map(normalizeDrug);

  return kb.filter(entry => {
    const genotypeMatches = genotypes[entry.gene] === entry.phenotype;
    const drugMatches = normalizedMeds.some(m =>
      m.includes(entry.drug.toLowerCase()) || entry.drug.toLowerCase().includes(m)
    );
    return genotypeMatches && drugMatches;
  });
}

const SEVERITY_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, MODERATE: 2, LOW: 3 };

export async function checkPharmacogenomics(input: {
  medications: string[];
  genotypes: Record<string, string>;
}): Promise<PGxFinding[]> {
  const { medications, genotypes } = input;
  if (!medications?.length || !genotypes || Object.keys(genotypes).length === 0) return [];

  const kb = loadPGxKB();
  const matchingEntries = findMatchingEntries(medications, genotypes, kb);

  if (matchingEntries.length === 0) return [];

  // Algorithmic findings from direct KB matches
  const algorithmicFindings: PGxFinding[] = matchingEntries.map(entry => ({
    finding: `PHARMACOGENOMICS ALERT: ${entry.gene} ${entry.phenotype.replace('_', ' ')} — ${entry.drug}`,
    severity: entry.severity,
    drug: entry.drug,
    gene: entry.gene,
    phenotype: entry.phenotype,
    consequence: entry.consequence,
    recommendation: entry.recommendation,
    source: entry.source,
  }));

  // Enrich with LLM if available
  const { systemPrompt, userPrompt } = buildPGxPrompt(medications, genotypes, matchingEntries);
  const sanitized = ensureNoFHIRCredentials(userPrompt);

  let llmFindings: PGxFinding[] = [];
  try {
    const response = await analyzeWithGemini(systemPrompt, sanitized);
    if (response && !response.includes('LLM analysis unavailable')) {
      const match = response.match(/\[[\s\S]*\]/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed)) llmFindings = parsed as PGxFinding[];
      }
    }
  } catch {
    console.error('[pharmacogenomics] LLM parse failed, using algorithmic findings');
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
