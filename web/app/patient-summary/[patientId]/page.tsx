async function getSummary(patientId: string) {
  const baseUrl = process.env['NEXT_PUBLIC_APP_URL'] ?? 'http://localhost:3001';
  const res = await fetch(`${baseUrl}/api/patient-summary/${patientId}`, { cache: 'no-store' });
  return res.json();
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
