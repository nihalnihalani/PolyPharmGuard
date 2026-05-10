import { NextRequest, NextResponse } from 'next/server';
import { loadReview } from '../../../../../src/persistence/reviews';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ reviewId: string }> }) {
  const { reviewId } = await params;

  // Dynamically import @react-pdf/renderer (server-side only)
  const { renderToBuffer, Document, Page, Text, View, StyleSheet } = await import('@react-pdf/renderer');

  // Prefer a persisted snapshot — that's the *exact* clinical result the
  // clinician saw at review time. Fall back to a live re-fetch only when
  // the snapshot isn't available (older reviews, or the persistence layer
  // failed to write). Live re-fetch may differ from the snapshot if KB or
  // scorer code has changed.
  type ReviewFinding = { severity: string; finding?: string; clinicalConsequence?: string; recommendation?: string };
  type ReviewPayload = {
    findings: {
      cascade?: ReviewFinding[];
      pd?: ReviewFinding[];
      pharmacogenomics?: (ReviewFinding & { consequence?: string })[];
      dosing?: ReviewFinding[];
      deprescribing?: ReviewFinding[];
      labMonitoring?: ReviewFinding[];
    };
    medications?: string[];
    riskScore?: { score: number; band?: string; interpretation?: string; method?: string; factors?: { name: string; weight: number; evidence: string }[]; disclaimer?: string };
    patientName?: string;
    patientId?: string;
  };
  let review: ReviewPayload;
  const snap = loadReview(reviewId);
  if (snap) {
    review = snap.outputs as ReviewPayload;
  } else {
    const baseUrl = process.env['NEXT_PUBLIC_APP_URL'] ?? _req.nextUrl.origin;
    const patientId = reviewId.split('_')[1] ?? 'unknown';
    const reviewRes = await fetch(`${baseUrl}/api/review/${patientId}`, { cache: 'no-store' });
    if (!reviewRes.ok) {
      return NextResponse.json({ error: 'Review unavailable', code: 'NO_SNAPSHOT_AND_LIVE_FAILED' }, { status: 404 });
    }
    review = await reviewRes.json() as ReviewPayload;
  }

  const styles = StyleSheet.create({
    page: { padding: 40, fontFamily: 'Helvetica', backgroundColor: '#ffffff' },
    title: { fontSize: 20, fontWeight: 'bold', marginBottom: 4 },
    subtitle: { fontSize: 11, color: '#6b7280', marginBottom: 20 },
    sectionHeader: { fontSize: 13, fontWeight: 'bold', marginTop: 16, marginBottom: 6, color: '#111827' },
    finding: { fontSize: 10, marginBottom: 8, padding: 8, backgroundColor: '#f9fafb', borderRadius: 4 },
    findingTitle: { fontWeight: 'bold', marginBottom: 3 },
    label: { fontSize: 9, color: '#6b7280', marginBottom: 1 },
    footer: { position: 'absolute', bottom: 30, left: 40, right: 40, fontSize: 8, color: '#9ca3af', textAlign: 'center' },
  });

  const allFindings = [
    ...(review.findings.cascade ?? []),
    ...(review.findings.pd ?? []),
    ...(review.findings.pharmacogenomics ?? []).map((f) => ({
      ...f,
      clinicalConsequence: f.clinicalConsequence ?? f.consequence,
    })),
    ...(review.findings.dosing ?? []),
    ...(review.findings.deprescribing ?? []),
    ...(review.findings.labMonitoring ?? []),
  ].filter((f: { severity: string }) => f.severity !== 'INFO');

  const doc = (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>PolyPharmGuard Medication Review</Text>
        <Text style={styles.subtitle}>
          Patient: {review.patientName ?? review.patientId} | Generated: {new Date().toLocaleDateString()} | Review ID: {reviewId}
        </Text>
        <Text style={styles.sectionHeader}>Medications Reviewed ({review.medications?.length ?? 0})</Text>
        <Text style={{ fontSize: 10, color: '#374151', marginBottom: 12 }}>
          {(review.medications ?? []).join(' \u2022 ')}
        </Text>
        {review.riskScore && (
          <>
            <Text style={styles.sectionHeader}>Composite Risk Index</Text>
            <Text style={{ fontSize: 10, marginBottom: 4 }}>
              Score: {review.riskScore.score}/100 ({review.riskScore.band ?? review.riskScore.interpretation})
              {' '}&middot; method: {review.riskScore.method ?? 'composite_heuristic_v1'}
            </Text>
            {Array.isArray(review.riskScore.factors) && review.riskScore.factors.length > 0 && (
              <View style={{ marginBottom: 8 }}>
                {(review.riskScore.factors as { name: string; weight: number; evidence: string }[])
                  .slice()
                  .sort((a, b) => b.weight - a.weight)
                  .map((f, i) => (
                    <Text key={i} style={{ fontSize: 9, color: '#374151', marginBottom: 1 }}>
                      +{f.weight}  {f.name}  -- {f.evidence}
                    </Text>
                  ))}
              </View>
            )}
            <Text style={{ fontSize: 8, color: '#6b7280', marginBottom: 12, fontStyle: 'italic' }}>
              {review.riskScore.disclaimer ?? 'Heuristic composite; not a validated clinical risk model. For research/demo use.'}
            </Text>
          </>
        )}
        <Text style={styles.sectionHeader}>Clinical Findings ({allFindings.length})</Text>
        {/* Render every actionable finding. Clinical documentation must not
            silently truncate — a clinician relying on the PDF could miss a
            relevant safety flag. Severity-sorted so CRITICAL/HIGH appear
            first; LOW/INFO are kept for completeness but visually demoted. */}
        {(() => {
          const sevOrder: Record<string, number> = { CRITICAL: 0, HIGH: 1, MODERATE: 2, LOW: 3, INFO: 4 };
          const sorted = [...allFindings].sort(
            (a: { severity: string }, b: { severity: string }) =>
              (sevOrder[a.severity] ?? 9) - (sevOrder[b.severity] ?? 9)
          );
          return sorted.map((f, i: number) => (
            <View key={i} style={styles.finding}>
              <Text style={styles.findingTitle}>[{f.severity}] {f.finding}</Text>
              {f.clinicalConsequence && <Text style={{ fontSize: 9 }}>{f.clinicalConsequence}</Text>}
              {f.recommendation && (
                <>
                  <Text style={[styles.label, { marginTop: 3 }]}>RECOMMENDATION:</Text>
                  <Text style={{ fontSize: 9 }}>{f.recommendation}</Text>
                </>
              )}
            </View>
          ));
        })()}
        <Text style={styles.footer}>
          PolyPharmGuard | Clinical Decision Support Tool | For professional use only | Not a substitute for clinical judgment
        </Text>
      </Page>
    </Document>
  );

  const buffer = await renderToBuffer(doc);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="polypharmguard-${review.patientId ?? reviewId.split('_')[1] ?? 'unknown'}-${Date.now()}.pdf"`,
    },
  });
}
