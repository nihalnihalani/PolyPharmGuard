import { ReviewPageClient } from './ReviewPageClient';
import { headers } from 'next/headers';

async function getReview(patientId: string) {
  const baseUrl = await deriveBaseUrl();
  const res = await fetch(`${baseUrl}/api/review/${patientId}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Review failed');
  return res.json();
}

async function deriveBaseUrl(): Promise<string> {
  const fromEnv = process.env['NEXT_PUBLIC_APP_URL'];
  if (fromEnv) return fromEnv;
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  const proto = h.get('x-forwarded-proto') ?? 'http';
  if (host) return `${proto}://${host}`;
  return 'http://localhost:3001';
}

export default async function ReviewPage({ params }: { params: Promise<{ patientId: string }> }) {
  const { patientId } = await params;
  const review = await getReview(patientId);

  const { riskScore, findings, reviewId, patientName, medications } = review;
  const allFindings = [
    ...(findings.cascade ?? []).map((f: Record<string, unknown>) => ({ ...f, toolName: 'cascade' })),
    ...(findings.pd ?? []).map((f: Record<string, unknown>) => ({ ...f, toolName: 'pd' })),
    ...(findings.pharmacogenomics ?? []).map((f: Record<string, unknown>) => ({
      ...f,
      clinicalConsequence: f['clinicalConsequence'] ?? f['consequence'],
      toolName: 'pharmacogenomics',
    })),
    ...(findings.dosing ?? []).map((f: Record<string, unknown>) => ({ ...f, toolName: 'dosing' })),
    ...(findings.deprescribing ?? []).map((f: Record<string, unknown>) => ({ ...f, toolName: 'deprescribing' })),
    ...(findings.labMonitoring ?? []).map((f: Record<string, unknown>) => ({ ...f, toolName: 'lab-monitoring' })),
  ];

  // Build interaction graph edges from BOTH PD and cascade findings.
  // Both types now expose a structured contributingDrugs array; we tag each edge
  // with a different label so cascade vs PD interactions are visually distinguishable.
  const pdEdges = (findings.pd ?? [])
    .filter((f: { contributingDrugs?: string[] }) => (f.contributingDrugs?.length ?? 0) >= 2)
    .map((f: { contributingDrugs: string[]; class: string; severity: string }) => ({
      from: f.contributingDrugs[0],
      to: f.contributingDrugs[1],
      severity: f.severity,
      label: f.class?.slice(0, 3) ?? 'PD',
      kind: 'pd' as const,
    }));

  const cascadeEdges = (findings.cascade ?? [])
    .filter((f: { contributingDrugs?: string[] }) => (f.contributingDrugs?.length ?? 0) >= 2)
    .map((f: { contributingDrugs: string[]; finding: string; severity: string }) => {
      // Pull the CYP enzyme out of the finding string for the edge label (e.g., "CYP2C19")
      const enzymeMatch = f.finding.match(/CYP\d[A-Z]?\d*/i);
      return {
        from: f.contributingDrugs[0],
        to: f.contributingDrugs[1],
        severity: f.severity,
        label: enzymeMatch ? enzymeMatch[0] : 'CYP',
        kind: 'cascade' as const,
      };
    });

  const interactions = [...cascadeEdges, ...pdEdges];

  // Build matrix rows server-side so the client component receives ready-to-
  // render data. Logic moved verbatim from the inline JSX block.
  const matrixRows = (medications as string[]).map((med: string) => {
    const stem = med.toLowerCase().split(' ')[0];
    const matchByMedicationField = (f: { medication?: string }) =>
      !!f.medication && f.medication.toLowerCase().includes(stem);
    const findingSeverityFor = <T extends { severity: string },>(
      arr: T[] | undefined,
      matcher: (f: T) => boolean
    ): 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW' | 'OK' => {
      const matches = (arr ?? []).filter(matcher);
      if (matches.length === 0) return 'OK';
      const sevRank: Record<string, number> = { CRITICAL: 0, HIGH: 1, MODERATE: 2, LOW: 3, INFO: 4 };
      const top = matches.sort((a, b) => (sevRank[a.severity] ?? 9) - (sevRank[b.severity] ?? 9))[0];
      return (top.severity as 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW') ?? 'OK';
    };
    const dosingMatches = (findings.dosing ?? []).filter(matchByMedicationField);
    const renalDosing = dosingMatches.filter((f: { finding?: string }) =>
      !!f.finding && f.finding.toUpperCase().includes('RENAL')
    );
    const hepaticDosing = dosingMatches.filter((f: { finding?: string }) =>
      !!f.finding && f.finding.toUpperCase().includes('HEPATIC')
    );
    return {
      medication: med,
      cascadeRisk: findingSeverityFor(
        findings.cascade as { severity: string; finding: string }[] | undefined,
        (f: { severity: string; finding: string }) => f.finding.toLowerCase().includes(stem) && f.severity !== 'LOW'
      ),
      pdRisk: findingSeverityFor(
        findings.pd as { severity: string; contributingDrugs?: string[] }[] | undefined,
        (f: { severity: string; contributingDrugs?: string[] }) =>
          !!f.contributingDrugs?.some((d: string) => d.toLowerCase().includes(stem))
      ),
      renalRisk: findingSeverityFor(renalDosing as { severity: string; medication?: string }[], () => true),
      hepaticRisk: findingSeverityFor(hepaticDosing as { severity: string; medication?: string }[], () => true),
      pgxRisk: findingSeverityFor(
        findings.pharmacogenomics as { severity: string; drug?: string }[] | undefined,
        (f: { severity: string; drug?: string }) => !!f.drug && f.drug.toLowerCase().includes(stem)
      ),
      beersFlag: (findings.deprescribing ?? []).some(
        (f: { medication?: string; beersFlag?: string | boolean }) =>
          !!f.medication && f.medication.toLowerCase().includes(stem) && !!f.beersFlag
      ),
      stoppfrailFlag: (findings.deprescribing ?? []).some(
        (f: { medication?: string; stoppfrailFlag?: string | boolean }) =>
          !!f.medication && f.medication.toLowerCase().includes(stem) && !!f.stoppfrailFlag
      ),
      labGap: (findings.labMonitoring ?? []).some(
        (f: { drug?: string }) => !!f.drug && f.drug.toLowerCase().includes(stem)
      ),
    };
  });

  return (
    <ReviewPageClient
      patientId={patientId}
      patientName={patientName}
      reviewId={reviewId}
      medications={medications}
      riskScore={riskScore}
      matrixRows={matrixRows}
      interactions={interactions as { from: string; to: string; severity: string; label: string; kind: 'cascade' | 'pd' }[]}
      allFindings={allFindings}
    />
  );
}
