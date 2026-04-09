import { NextRequest, NextResponse } from 'next/server';
import { analyzeCascadeInteractions } from '../../../../../src/mcp-server/tools/cascade-interactions';
import { checkOrganFunctionDosing } from '../../../../../src/mcp-server/tools/organ-function-dosing';
import { screenDeprescribing } from '../../../../../src/mcp-server/tools/deprescribing-screen';
import { analyzePDInteractions } from '../../../../../src/mcp-server/tools/pd-interactions';
import { checkLabMonitoring } from '../../../../../src/mcp-server/tools/lab-monitoring';
import { logToolCall } from '../../../../../src/audit/db';
import { loadMrsJohnsonData } from '../../../../../data/synthea/mrs-johnson/index';
import { createHash } from 'node:crypto';

function hashInput(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 16);
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ patientId: string }> }) {
  const { patientId } = await params;
  const start = Date.now();

  // For demo: use Mrs. Johnson data
  // In production: fetch from FHIR server using patientId
  const patientData = loadMrsJohnsonData();

  // Extract medication names from FHIR resources
  const medications = patientData.medications.map(m => m.medicationCodeableConcept?.text ?? 'Unknown');

  // Extract lab values from observations
  const recentLabs = patientData.observations
    .filter(o => o.valueQuantity)
    .map(o => ({
      loincCode: o.code.coding?.[0]?.code ?? '',
      value: o.valueQuantity!.value,
      date: o.effectiveDateTime ?? '',
      labName: o.code.text ?? o.code.coding?.[0]?.display ?? '',
    }));

  // Get patient age from birthDate
  const birthDate = patientData.patient.birthDate;
  const patientAge = birthDate
    ? Math.floor((Date.now() - new Date(birthDate).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
    : 78;

  // Get patient name
  const nameEntry = patientData.patient.name?.[0];
  const patientName = nameEntry
    ? `${nameEntry.prefix?.[0] ?? ''} ${nameEntry.given?.[0] ?? ''} ${nameEntry.family ?? ''}`.trim()
    : patientId;

  // Run all tools in parallel
  const [cascade, dosing, deprescribing, pd, labMonitoring] = await Promise.all([
    analyzeCascadeInteractions({ medications }).catch(() => []),
    checkOrganFunctionDosing({ medications }).catch(() => []),
    screenDeprescribing({ medications, patientAge }).catch(() => []),
    analyzePDInteractions({ medications }).catch(() => []),
    checkLabMonitoring({ medications, recentLabs }).catch(() => []),
  ]);

  const reviewId = `review_${patientId}_${Date.now()}`;
  const outputs = { cascade, dosing, deprescribing, pd, labMonitoring };

  // Log to audit trail
  try {
    logToolCall({
      patientId,
      toolName: 'full_review',
      inputsHash: hashInput({ medications, patientId }),
      outputsJson: JSON.stringify(outputs),
      latencyMs: Date.now() - start,
    });
  } catch {
    // Audit logging failure should not block the review
  }

  // Fetch risk score from ML service (if available)
  let riskScore = null;
  try {
    const mlResponse = await fetch('http://localhost:8001/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        age: patientAge,
        egfr: recentLabs.find(o => o.loincCode === '33914-3')?.value ?? 90,
        medications,
        cyp_interactions: cascade.filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH').length,
        pd_risk_score: pd.reduce((s, f) => s + (f.riskScore ?? 0), 0),
        beers_count: deprescribing.filter(f => f.beersFlag).length,
        lab_gaps: labMonitoring.filter(f => f.status !== 'CURRENT').length,
      }),
    });
    if (mlResponse.ok) riskScore = await mlResponse.json();
  } catch {
    // ML service not running — continue without score
  }

  return NextResponse.json({
    reviewId,
    patientId,
    patientName,
    medications,
    riskScore,
    findings: outputs,
    timestamp: new Date().toISOString(),
  });
}
