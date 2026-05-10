import { headers } from 'next/headers';
import { BatchPageClient } from './BatchPageClient';

// Real patients with synthea bundles in data/synthea/.
// John Doe / Jane Smith are vapor — the patient-loader falls through to Mrs.
// Johnson for any unknown ID, which masks the demo. Keep this list aligned
// with `web/app/api/review/[patientId]/route.ts::loadPatientByID`.
const REAL_PATIENTS: { id: string; name: string }[] = [
  { id: 'mr-patel', name: 'Mr. Patel' },
  { id: 'mrs-johnson', name: 'Mrs. Johnson' },
];

interface ReviewSnapshot {
  id: string;
  name: string;
  medCount: number;
  score: number | null;
  band: 'Low' | 'Moderate' | 'High' | 'Critical' | null;
  interpretation: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL' | null;
  error: boolean;
}

async function deriveBaseUrl(): Promise<string> {
  const fromEnv = process.env['NEXT_PUBLIC_APP_URL'];
  if (fromEnv) return fromEnv;
  // Fall back to forwarded headers so the server component can call its own
  // API route during SSR without hardcoding the dev-server port.
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  const proto = h.get('x-forwarded-proto') ?? 'http';
  if (host) return `${proto}://${host}`;
  return 'http://localhost:3001';
}

async function fetchSnapshot(baseUrl: string, p: { id: string; name: string }): Promise<ReviewSnapshot> {
  try {
    const res = await fetch(`${baseUrl}/api/review/${p.id}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const review = await res.json();
    return {
      id: p.id,
      name: review.patientName ?? p.name,
      medCount: Array.isArray(review.medications) ? review.medications.length : 0,
      score: review?.riskScore?.score ?? null,
      band: review?.riskScore?.band ?? null,
      interpretation: review?.riskScore?.interpretation ?? null,
      error: false,
    };
  } catch {
    return {
      id: p.id,
      name: p.name,
      medCount: 0,
      score: null,
      band: null,
      interpretation: null,
      error: true,
    };
  }
}

export default async function BatchPage() {
  const baseUrl = await deriveBaseUrl();
  const snapshots = await Promise.all(REAL_PATIENTS.map(p => fetchSnapshot(baseUrl, p)));

  // Sort descending by score; nulls (errored) sink to the bottom.
  snapshots.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

  return <BatchPageClient snapshots={snapshots} />;
}
