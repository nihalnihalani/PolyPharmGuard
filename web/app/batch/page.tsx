import Link from 'next/link';
import { Button } from '@/components/ui/button';

// Demo batch -- in production this comes from FHIR patient list
const DEMO_PATIENTS = [
  { id: 'mrs-johnson', name: 'Mrs. Johnson', age: 78, meds: 12, risk: 74, interpretation: 'CRITICAL' },
  { id: 'john-doe', name: 'John Doe', age: 71, meds: 8, risk: 52, interpretation: 'HIGH' },
  { id: 'jane-smith', name: 'Jane Smith', age: 65, meds: 5, risk: 28, interpretation: 'MODERATE' },
];

const BADGE_STYLES: Record<string, string> = {
  CRITICAL: 'bg-red-900 text-red-300',
  HIGH: 'bg-orange-900 text-orange-300',
  MODERATE: 'bg-yellow-900 text-yellow-300',
  LOW: 'bg-green-900 text-green-300',
};

export default function BatchPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Pharmacist Review Queue</h1>
        <p className="text-gray-400 text-sm mt-1">Patients ranked by 90-day adverse event risk -- review highest-risk first</p>
      </div>
      <div className="space-y-3">
        {DEMO_PATIENTS.map((patient) => (
          <div key={patient.id} className="rounded-xl border border-gray-800 bg-gray-900 p-5 flex items-center gap-6">
            <div className={`text-2xl font-black px-4 py-2 rounded-lg ${BADGE_STYLES[patient.interpretation]}`}>
              {patient.risk}
            </div>
            <div className="flex-1">
              <div className="font-semibold text-white">{patient.name}</div>
              <div className="text-sm text-gray-400">Age {patient.age} -- {patient.meds} active medications</div>
            </div>
            <span className={`text-xs font-bold px-2 py-1 rounded ${BADGE_STYLES[patient.interpretation]}`}>
              {patient.interpretation}
            </span>
            <Link href={`/review/${patient.id}`}>
              <Button size="sm" variant="outline" className="border-gray-700 text-gray-300">Review</Button>
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
