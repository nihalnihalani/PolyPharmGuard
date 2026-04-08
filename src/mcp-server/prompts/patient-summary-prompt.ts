import type { CascadeFinding, DosingFinding, DeprescribingFinding, PDFinding, LabMonitoringFinding } from '../../types/clinical.js';

export function buildPatientSummaryPrompt(findings: {
  cascade?: CascadeFinding[];
  dosing?: DosingFinding[];
  deprescribing?: DeprescribingFinding[];
  pd?: PDFinding[];
  labMonitoring?: LabMonitoringFinding[];
}, patientName?: string): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = `You are a patient advocate translating medical findings into plain language a patient can understand.

CRITICAL RULES:
1. Write at a 6th-grade reading level (Flesch-Kincaid grade 6 or below).
2. NO medical jargon without immediate plain-language explanation.
3. Three sections ONLY: "What we found", "Why it matters", "Questions to ask your doctor".
4. Be reassuring but accurate — do not minimize serious findings.
5. Do NOT include specific drug names without explanation.
6. Return plain text — no JSON, no markdown.`;

  const allFindings = [
    ...(findings.cascade ?? []).filter(f => f.severity !== 'INFO').map(f => `MEDICATION INTERACTION: ${f.finding} — ${f.clinicalConsequence}`),
    ...(findings.dosing ?? []).filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH').map(f => `DOSE CONCERN: ${f.finding} — ${f.recommendation}`),
    ...(findings.deprescribing ?? []).filter(f => f.severity !== 'LOW').map(f => `MEDICATION REVIEW: ${f.medication} — ${f.indicationStatus}`),
    ...(findings.pd ?? []).filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH').map(f => `COMBINED DRUG EFFECT: ${f.finding} — ${f.clinicalConsequence}`),
    ...(findings.labMonitoring ?? []).filter(f => f.status !== 'CURRENT').map(f => `MISSING TEST: ${f.drug} requires ${f.labName} — ${f.status}`),
  ];

  const userPrompt = `Write a plain-language summary for ${patientName ?? 'the patient'} based on these medication review findings:

${allFindings.map((f, i) => `${i + 1}. ${f}`).join('\n')}

Format as three labeled sections:
1. What we found
2. Why it matters
3. Questions to ask your doctor`;

  return { systemPrompt, userPrompt };
}
