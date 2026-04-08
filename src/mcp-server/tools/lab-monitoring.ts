import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { LabMonitoringFinding, LabMonitoringEntry, PatientContext } from '../../types/clinical.js';
import { analyzeWithGemini } from '../../llm/gemini.js';
import { ensureNoFHIRCredentials } from '../../llm/guardrails.js';
import { buildLabMonitoringPrompt } from '../prompts/lab-monitoring-prompt.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const KB_PATH = join(__dirname, '../../knowledge-base/lab-monitoring.json');

function loadLabKB(): LabMonitoringEntry[] {
  return JSON.parse(readFileSync(KB_PATH, 'utf-8'));
}

function normalizeDrug(name: string): string {
  return name.toLowerCase().trim().replace(/\s*\d+\s*(mg|mcg|ml|meq|g)\s*(daily|bid|tid|once|twice|three times)?.*/i, '').trim();
}

function daysBetween(date1: string, date2: Date): number {
  const d1 = new Date(date1);
  return Math.floor((date2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
}

const SEVERITY_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, MODERATE: 2, LOW: 3 };

export async function checkLabMonitoring(input: {
  medications: string[];
  recentLabs: Array<{ loincCode: string; value: number; date: string; labName: string }>;
  patientContext?: PatientContext | null;
}): Promise<LabMonitoringFinding[]> {
  const { medications, recentLabs } = input;
  if (!medications?.length) return [];

  const kb = loadLabKB();
  const normalizedMeds = medications.map(normalizeDrug);
  const now = new Date();

  // Find KB entries matching patient's medications
  const matchedEntries = kb.filter(entry =>
    normalizedMeds.some(m => m.includes(entry.drug.toLowerCase()) || entry.drug.toLowerCase().includes(m))
  );

  if (matchedEntries.length === 0) return [];

  // Algorithmic findings
  const findings: LabMonitoringFinding[] = [];

  for (const entry of matchedEntries) {
    for (const labReq of entry.requiredLabs) {
      const recentResult = recentLabs
        .filter(l => l.loincCode === labReq.loincCode)
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];

      let status: LabMonitoringFinding['status'] = 'MISSING';
      let daysSince: number | undefined;
      let severity: LabMonitoringFinding['severity'] = 'HIGH';

      if (recentResult) {
        daysSince = daysBetween(recentResult.date, now);

        if (labReq.actionThreshold) {
          const { criticalHigh, criticalLow } = labReq.actionThreshold;
          if ((criticalHigh && recentResult.value > criticalHigh) ||
              (criticalLow && recentResult.value < criticalLow)) {
            status = 'OUT_OF_RANGE';
            severity = 'CRITICAL';
          } else if (labReq.therapeuticRange) {
            const { min, max } = labReq.therapeuticRange;
            if (recentResult.value < min || recentResult.value > max) {
              status = 'OUT_OF_RANGE';
              severity = 'HIGH';
            } else if (daysSince > labReq.monitoringFrequencyDays) {
              status = 'OVERDUE';
              severity = 'MODERATE';
            } else {
              status = 'CURRENT';
              severity = 'LOW';
            }
          } else if (daysSince > labReq.monitoringFrequencyDays) {
            status = 'OVERDUE';
            severity = 'MODERATE';
          } else {
            status = 'CURRENT';
            severity = 'LOW';
          }
        } else if (daysSince > labReq.monitoringFrequencyDays) {
          status = 'OVERDUE';
          severity = 'MODERATE';
        } else {
          status = 'CURRENT';
          severity = 'LOW';
        }
      }

      if (status === 'CURRENT') continue; // Don't report current monitoring

      findings.push({
        finding: `LAB MONITORING ${status}: ${entry.drug} requires ${labReq.labName}`,
        severity,
        drug: entry.drug,
        labName: labReq.labName,
        loincCode: labReq.loincCode,
        lastResultDate: recentResult?.date,
        lastResultValue: recentResult?.value,
        daysSinceLastCheck: daysSince,
        status,
        recommendation: labReq.action,
        source: labReq.source,
      });
    }
  }

  // Enrich with LLM if available
  const { systemPrompt, userPrompt } = buildLabMonitoringPrompt(medications, matchedEntries, recentLabs);
  const sanitized = ensureNoFHIRCredentials(userPrompt);

  let llmFindings: LabMonitoringFinding[] = [];
  try {
    const response = await analyzeWithGemini(systemPrompt, sanitized);
    if (response && !response.includes('LLM analysis unavailable')) {
      const match = response.match(/\[[\s\S]*\]/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed)) llmFindings = parsed as LabMonitoringFinding[];
      }
    }
  } catch {
    console.error('[lab-monitoring] LLM parse failed, using algorithmic findings');
  }

  // TODO H1: merge rather than replace once all tools are stable
  const finalFindings = llmFindings.length > 0 ? llmFindings : findings;
  return finalFindings.sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99));
}
