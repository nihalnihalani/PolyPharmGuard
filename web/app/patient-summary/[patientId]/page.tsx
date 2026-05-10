import { headers } from 'next/headers';

async function getSummary(patientId: string) {
  const baseUrl = await deriveBaseUrl();
  const res = await fetch(`${baseUrl}/api/patient-summary/${patientId}`, { cache: 'no-store' });
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

export default async function PatientSummaryPage({ params }: { params: Promise<{ patientId: string }> }) {
  const { patientId } = await params;
  const data = await getSummary(patientId);

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Your Medication Review Summary</h1>
        <p className="text-gray-400 text-sm mt-1">For {data.patientName ?? patientId} -- {new Date(data.generatedAt).toLocaleDateString()}</p>
      </div>
      <div className="bg-gray-900 rounded-2xl border border-gray-800 p-8">
        <div className="prose prose-invert prose-sm max-w-none whitespace-pre-wrap text-gray-300 leading-relaxed">
          {data.summary}
        </div>
      </div>
      <p className="text-xs text-gray-600 mt-4 text-center">
        This summary is for informational purposes. Always discuss medication changes with your healthcare provider.
      </p>
    </div>
  );
}
