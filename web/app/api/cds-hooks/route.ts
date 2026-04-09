import { NextRequest, NextResponse } from 'next/server';
import { analyzeCascadeInteractions } from '../../../../src/mcp-server/tools/cascade-interactions';
import { analyzePDInteractions } from '../../../../src/mcp-server/tools/pd-interactions';

// HL7 CDS Hooks 2.0 — https://cds-hooks.org/specification/current/
// Implements: medication-prescribe and patient-view hooks

interface CDSCard {
  summary: string;
  detail: string;
  indicator: 'info' | 'warning' | 'critical';
  source: { label: string; url?: string };
  suggestions?: Array<{ label: string; uuid: string }>;
}

const SEVERITY_TO_INDICATOR: Record<string, CDSCard['indicator']> = {
  CRITICAL: 'critical',
  HIGH: 'warning',
  MODERATE: 'warning',
  LOW: 'info',
};

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { hook, context } = body;

  if (!hook || !context) {
    return NextResponse.json({ cards: [] });
  }

  // Extract medications from CDS Hooks context
  let medications: string[] = [];
  if (context.medications?.entry) {
    medications = context.medications.entry
      .map((e: { resource?: { medicationCodeableConcept?: { text?: string } } }) =>
        e.resource?.medicationCodeableConcept?.text)
      .filter(Boolean);
  }
  if (context.draftOrders?.entry) {
    const newMeds = context.draftOrders.entry
      .map((e: { resource?: { medicationCodeableConcept?: { text?: string } } }) =>
        e.resource?.medicationCodeableConcept?.text)
      .filter(Boolean);
    medications = [...medications, ...newMeds];
  }

  if (medications.length === 0) return NextResponse.json({ cards: [] });

  // Run interaction analysis
  const [cascade, pd] = await Promise.all([
    analyzeCascadeInteractions({ medications }).catch(() => []),
    analyzePDInteractions({ medications }).catch(() => []),
  ]);

  const allFindings = [
    ...(cascade ?? []).map((f: { severity: string; finding: string; clinicalConsequence: string; recommendation: string }) => ({ ...f, source: 'CYP450 Cascade Analysis' })),
    ...(pd ?? []).map((f: { severity: string; finding: string; clinicalConsequence: string; recommendation: string }) => ({ ...f, source: 'Pharmacodynamic Risk Analysis' })),
  ].filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH');

  const cards: CDSCard[] = allFindings.slice(0, 3).map(finding => ({
    summary: finding.finding,
    detail: `${finding.clinicalConsequence}\n\nRecommendation: ${finding.recommendation}`,
    indicator: SEVERITY_TO_INDICATOR[finding.severity] ?? 'warning',
    source: {
      label: `PolyPharmGuard -- ${finding.source}`,
    },
    suggestions: [
      { label: 'View full medication review', uuid: `ppg_${Date.now()}` },
    ],
  }));

  return NextResponse.json({ cards });
}

// CDS Discovery endpoint
export async function GET() {
  return NextResponse.json({
    services: [
      {
        hook: 'medication-prescribe',
        id: 'polypharmguard-prescribe',
        title: 'PolyPharmGuard -- Cascade Interaction Check',
        description: 'Detects CYP450 cascade and pharmacodynamic interactions for newly prescribed medications',
        prefetch: {
          medications: 'MedicationRequest?patient={{context.patientId}}&status=active',
        },
      },
      {
        hook: 'patient-view',
        id: 'polypharmguard-patient-view',
        title: 'PolyPharmGuard -- Active Medication Review',
        description: 'Reviews active medication list for cascade interactions, PD risks, and dosing concerns',
        prefetch: {
          medications: 'MedicationRequest?patient={{context.patientId}}&status=active',
        },
      },
    ],
  });
}
