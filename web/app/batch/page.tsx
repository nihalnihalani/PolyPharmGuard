import Link from 'next/link';
import { headers } from 'next/headers';
import { Button } from '@/components/ui/button';

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

const BADGE_STYLES: Record<string, string> = {
  CRITICAL: 'bg-red-900 text-red-300',
  HIGH: 'bg-orange-900 text-orange-300',
  MODERATE: 'bg-yellow-900 text-yellow-300',
  LOW: 'bg-green-900 text-green-300',
  UNKNOWN: 'bg-gray-800 text-gray-400',
};

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

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Pharmacist Review Queue</h1>
        <p className="text-gray-400 text-sm mt-1">
          Patients ranked by composite risk index -- review highest-risk first
        </p>
      </div>
      <div className="space-y-3">
        {snapshots.map((patient) => {
          const tone = patient.interpretation ?? 'UNKNOWN';
          const badgeClass = BADGE_STYLES[tone] ?? BADGE_STYLES['UNKNOWN'];
          return (
            <div
              key={patient.id}
              className="rounded-xl border border-gray-800 bg-gray-900 p-5 flex items-center gap-6"
            >
              <div className={`text-2xl font-black px-4 py-2 rounded-lg ${badgeClass}`}>
                {patient.score ?? '--'}
              </div>
              <div className="flex-1">
                <div className="font-semibold text-white">{patient.name}</div>
                <div className="text-sm text-gray-400">
                  {patient.error
                    ? 'Review unavailable -- check API'
                    : `${patient.medCount} active medication${patient.medCount === 1 ? '' : 's'}`}
                </div>
              </div>
              <span className={`text-xs font-bold px-2 py-1 rounded ${badgeClass}`}>
                {patient.band ?? patient.interpretation ?? 'UNKNOWN'}
              </span>
              <Link href={`/review/${patient.id}`}>
                <Button size="sm" variant="outline" className="border-gray-700 text-gray-300">
                  Review
                </Button>
              </Link>
            </div>
          );
        })}
      </div>
    </div>
  );
}
