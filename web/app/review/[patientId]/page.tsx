import { RiskScoreGauge } from '@/components/RiskScoreGauge';
import { MedicationRiskMatrix } from '@/components/MedicationRiskMatrix';
import { EvidenceChainAccordion } from '@/components/EvidenceChainAccordion';
import { DrugInteractionGraph } from '@/components/DrugInteractionGraph';
import { ActionBar } from '@/components/ActionBar';
import Link from 'next/link';

async function getReview(patientId: string) {
  const baseUrl = process.env['NEXT_PUBLIC_APP_URL'] ?? 'http://localhost:3001';
  const res = await fetch(`${baseUrl}/api/review/${patientId}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Review failed');
  return res.json();
}

export default async function ReviewPage({ params }: { params: Promise<{ patientId: string }> }) {
  const { patientId } = await params;
  const review = await getReview(patientId);

  const { riskScore, findings, reviewId, patientName, medications } = review;
  const allFindings = [
    ...(findings.cascade ?? []).map((f: Record<string, unknown>) => ({ ...f, toolName: 'cascade' })),
    ...(findings.pd ?? []).map((f: Record<string, unknown>) => ({ ...f, toolName: 'pd' })),
    ...(findings.dosing ?? []).map((f: Record<string, unknown>) => ({ ...f, toolName: 'dosing' })),
    ...(findings.deprescribing ?? []).map((f: Record<string, unknown>) => ({ ...f, toolName: 'deprescribing' })),
    ...(findings.labMonitoring ?? []).map((f: Record<string, unknown>) => ({ ...f, toolName: 'lab-monitoring' })),
  ];

  // Build interaction graph edges from PD findings (structured contributingDrugs array)
  // Cascade findings use unstructured text — extracting drug names from PD's typed array is more reliable
  const interactions = (findings.pd ?? [])
    .filter((f: { contributingDrugs?: string[] }) => (f.contributingDrugs?.length ?? 0) >= 2)
    .map((f: { contributingDrugs: string[]; class: string; severity: string }) => ({
      from: f.contributingDrugs[0],
      to: f.contributingDrugs[1],
      severity: f.severity,
      label: f.class?.slice(0, 3) ?? 'PD',
    }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">{patientName ?? patientId}</h1>
          <p className="text-gray-400 text-sm">{medications.length} medications reviewed</p>
        </div>
        <div className="flex gap-3">
          <Link href={`/patient-summary/${patientId}`} className="text-sm text-blue-400 hover:underline">Patient Summary</Link>
          <Link href={`/api/reports/${reviewId}`} className="text-sm text-gray-400 hover:underline">PDF Report</Link>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-1">
          {riskScore ? (
            <RiskScoreGauge
              score={riskScore.score}
              interpretation={riskScore.interpretation}
              band={riskScore.band}
              factors={riskScore.factors}
              method={riskScore.method}
              disclaimer={riskScore.disclaimer}
            />
          ) : (
            <div className="rounded-xl border border-gray-800 p-6 text-center text-gray-500">Risk scoring unavailable</div>
          )}
        </div>
        <div className="col-span-2">
          <MedicationRiskMatrix rows={medications.slice(0, 8).map((med: string) => ({
            medication: med,
            cascadeRisk: (findings.cascade ?? []).some((f: { finding: string; severity: string }) => f.finding.includes(med.split(' ')[0]) && f.severity !== 'LOW') ? 'HIGH' as const : 'OK' as const,
            pdRisk: (findings.pd ?? []).some((f: { contributingDrugs?: string[] }) => f.contributingDrugs?.some((d: string) => d.toLowerCase().includes(med.toLowerCase().split(' ')[0]))) ? 'MODERATE' as const : 'OK' as const,
            renalRisk: (findings.dosing ?? []).some((f: { medication?: string; severity: string }) => f.medication?.includes(med.split(' ')[0])) ? 'HIGH' as const : 'OK' as const,
            beersFlag: (findings.deprescribing ?? []).some((f: { medication?: string; beersFlag?: boolean }) => f.medication?.includes(med.split(' ')[0]) && f.beersFlag),
            labGap: (findings.labMonitoring ?? []).some((f: { drug?: string }) => f.drug?.toLowerCase().includes(med.toLowerCase().split(' ')[0])),
          }))} />
        </div>
      </div>

      <DrugInteractionGraph medications={medications} interactions={interactions as { from: string; to: string; severity: string; label: string }[]} />

      <div>
        <h2 className="text-lg font-semibold text-white mb-3">
          {allFindings.filter((f: { severity: string }) => f.severity !== 'INFO' && f.severity !== 'LOW').length} Actionable Findings
        </h2>
        <div className="space-y-2">
          {allFindings
            .filter((f: { severity: string }) => f.severity !== 'LOW' && f.severity !== 'INFO')
            .map((finding: { finding: string; severity: string; chain?: { step: number; fact: string; source: string }[]; clinicalConsequence?: string; recommendation?: string; toolName?: string }, i: number) => (
            <div key={i} className="rounded-lg border border-gray-800 p-4">
              <EvidenceChainAccordion findings={[{
                finding: finding.finding,
                severity: finding.severity,
                chain: finding.chain ?? [],
                clinicalConsequence: finding.clinicalConsequence ?? '',
                recommendation: finding.recommendation ?? '',
                toolName: finding.toolName,
              }]} />
              <ActionBar
                reviewId={reviewId}
                findingId={`finding_${i}`}
                findingSummary={finding.finding}
                severity={finding.severity}
                toolName={finding.toolName}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
