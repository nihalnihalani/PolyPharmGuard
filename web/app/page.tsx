import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function HomePage() {
  return (
    <div className="max-w-3xl mx-auto mt-12 space-y-10">
      <header className="text-center">
        <h1 className="text-4xl font-black text-white mb-3">PolyPharmGuard</h1>
        <p className="text-gray-400 text-lg">A pairwise drug-interaction checker would catch one of these.</p>
        <p className="text-red-400 font-semibold mt-1">A multi-enzyme reasoning engine catches the cascade that ends careers.</p>
      </header>

      {/* Headline case — Mr. Patel */}
      <section className="bg-gradient-to-b from-red-950/20 to-gray-950 rounded-2xl border border-red-900/40 p-8">
        <div className="flex items-center gap-2 mb-3">
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold border bg-red-900 text-red-300 border-red-700">
            AI FACTOR
          </span>
          <span className="text-xs text-gray-500 uppercase tracking-wider">Headline case</span>
        </div>
        <h2 className="text-2xl font-bold text-white mb-2">Mr. Raj Patel — 62yo, post drug-eluting stent</h2>
        <p className="text-gray-400 text-sm leading-relaxed mb-5 max-w-2xl">
          Newly started fluvoxamine for OCD. Recent Paxlovid course. Atorvastatin, clopidogrel, tizanidine.
          Renal and hepatic function are normal — pairwise checkers see two routine alerts. The cascade
          engine sees a three-step pharmacokinetic chain ending in stent thrombosis risk.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/review/mr-patel-001">
            <Button size="lg" className="bg-red-600 hover:bg-red-700 text-white font-bold px-7">
              Run Medication Review
            </Button>
          </Link>
          <Link href="/comparison">
            <Button size="lg" variant="outline" className="border-gray-700 text-gray-200 hover:bg-gray-900 px-7">
              Pairwise vs. Synthesis →
            </Button>
          </Link>
          <Link href="/cases/mr-patel">
            <Button size="lg" variant="ghost" className="text-gray-400 hover:text-white px-4">
              Case background
            </Button>
          </Link>
        </div>
      </section>

      {/* Companion case — Mrs. Johnson */}
      <section className="bg-gray-900 rounded-2xl border border-gray-800 p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Companion case</p>
            <h3 className="text-lg font-semibold text-white">Mrs. Margaret Johnson — 78yo, eGFR 28, 12 medications</h3>
            <p className="text-gray-400 text-sm mt-1">
              Renal-dose contraindications, Beers Criteria flags, deprescribing candidates.
            </p>
          </div>
          <Link href="/review/mrs-johnson">
            <Button variant="outline" className="border-gray-700 text-gray-300 hover:bg-gray-800">
              Run review
            </Button>
          </Link>
        </div>
      </section>
    </div>
  );
}
