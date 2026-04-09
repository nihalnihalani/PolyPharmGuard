import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function HomePage() {
  return (
    <div className="max-w-2xl mx-auto mt-16 text-center">
      <h1 className="text-4xl font-black text-white mb-3">PolyPharmGuard</h1>
      <p className="text-gray-400 mb-2 text-lg">The EHR fired 23 alerts. The doctor ignored all of them.</p>
      <p className="text-red-400 font-semibold mb-10">We found three that could save her life.</p>
      <div className="bg-gray-900 rounded-2xl border border-gray-800 p-8">
        <p className="text-gray-400 mb-6 text-sm">Demo patient -- Mrs. Johnson, 78yo, 12 medications, eGFR 28</p>
        <Link href="/review/mrs-johnson">
          <Button size="lg" className="bg-red-600 hover:bg-red-700 text-white font-bold px-8">
            Run Medication Review
          </Button>
        </Link>
      </div>
    </div>
  );
}
