import type { LabMonitoringEntry } from '../../types/clinical.js';

export function buildLabMonitoringPrompt(
  medications: string[],
  matchedEntries: LabMonitoringEntry[],
  recentLabs: Array<{ loincCode: string; value: number; date: string; labName: string }>
): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = `You are a clinical pharmacist reviewing medication safety monitoring. You identify medications that require laboratory monitoring and flag gaps in current monitoring.

CRITICAL RULES:
1. Only report monitoring gaps for drugs present in the provided KB entries.
2. Every finding must cite the source from the KB entry.
3. Return a JSON array of LabMonitoringFinding objects only — no prose.`;

  const userPrompt = `Review the following medications for required lab monitoring gaps.

Medications: ${medications.join(', ')}

Recent lab results (from FHIR):
${JSON.stringify(recentLabs, null, 2)}

Required monitoring KB:
${JSON.stringify(matchedEntries, null, 2)}

Current date: ${new Date().toISOString().split('T')[0]}

Return a JSON array of LabMonitoringFinding objects:
[{
  "finding": "string",
  "severity": "CRITICAL|HIGH|MODERATE|LOW",
  "drug": "string",
  "labName": "string",
  "loincCode": "string",
  "lastResultDate": "string|null",
  "lastResultValue": "number|null",
  "daysSinceLastCheck": "number|null",
  "status": "MISSING|OVERDUE|OUT_OF_RANGE|CURRENT",
  "recommendation": "string",
  "source": "string"
}]

Return [] if all monitoring is current. Return JSON only.`;

  return { systemPrompt, userPrompt };
}
