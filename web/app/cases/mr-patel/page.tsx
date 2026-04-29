import Link from 'next/link';

/**
 * Mr. Raj Patel — Case background page.
 * A clinician-facing primer that frames why this regimen is the AI Factor demo.
 * The actual review (with risk score, matrix, evidence chains) lives at
 * /review/mr-patel-001.
 */

export default function MrPatelCasePage() {
  return (
    <div className="space-y-6 max-w-4xl">
      <header>
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Case</p>
        <h1 className="text-3xl font-bold text-white">Mr. Raj Patel</h1>
        <p className="text-gray-400 mt-1">62yo male — synthetic patient, no PHI</p>
      </header>

      <section className="rounded-xl border border-gray-800 bg-gray-950/50 p-6">
        <h2 className="text-lg font-semibold text-white mb-3">Active medications</h2>
        <ul className="text-sm text-gray-300 space-y-1.5">
          <li><span className="text-white font-medium">Fluvoxamine 100mg daily</span> — started 4 weeks ago for newly diagnosed OCD</li>
          <li><span className="text-white font-medium">Tizanidine 4mg TID PRN</span> — chronic lumbar muscle spasm</li>
          <li><span className="text-white font-medium">Clopidogrel 75mg daily</span> — DAPT post drug-eluting stent (9 months ago)</li>
          <li><span className="text-white font-medium">Atorvastatin 40mg daily</span> — secondary prevention post-PCI</li>
          <li><span className="text-white font-medium">Lisinopril 20mg daily</span> — hypertension</li>
          <li><span className="text-white font-medium">Metformin 1000mg BID</span> — type 2 diabetes</li>
          <li><span className="text-white font-medium">Aspirin 81mg daily</span> — DAPT post-stent</li>
          <li className="text-gray-400">
            <span className="font-medium">Nirmatrelvir/ritonavir (Paxlovid)</span> — completed 7 days ago for COVID-19 (residual CYP3A4 inhibition ~3-4 days post-discontinuation)
          </li>
        </ul>
      </section>

      <section className="rounded-xl border border-gray-800 bg-gray-950/50 p-6">
        <h2 className="text-lg font-semibold text-white mb-3">Conditions & labs</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Conditions</p>
            <ul className="text-gray-300 space-y-1">
              <li>Type 2 diabetes mellitus</li>
              <li>Essential hypertension</li>
              <li>Obsessive-compulsive disorder (new)</li>
              <li>Status post drug-eluting coronary stent (12-month DAPT)</li>
              <li>COVID-19 (recent, treated)</li>
              <li>Chronic lumbar muscle spasm</li>
            </ul>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Recent labs</p>
            <ul className="text-gray-300 space-y-1">
              <li>eGFR <span className="text-white">78</span> mL/min/1.73m² (normal)</li>
              <li>Serum creatinine <span className="text-white">1.0</span> mg/dL</li>
              <li>ALT <span className="text-white">32</span> U/L · AST <span className="text-white">28</span> U/L</li>
              <li>Total bilirubin <span className="text-white">0.7</span> mg/dL</li>
              <li>HbA1c <span className="text-white">7.2%</span></li>
            </ul>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-red-900/40 bg-gradient-to-b from-red-950/10 to-gray-950/50 p-6">
        <h2 className="text-lg font-semibold text-white mb-3">Why this case demonstrates the AI Factor</h2>
        <p className="text-sm text-gray-300 leading-relaxed mb-4">
          Mr. Patel's renal and hepatic function are normal. There is no eGFR-driven contraindication
          to flag. What makes this regimen dangerous is a <span className="text-white font-medium">three-step CYP cascade</span> that no
          pairwise drug-interaction table contains:
        </p>
        <ol className="text-sm text-gray-300 space-y-3 list-decimal list-inside">
          <li>
            <span className="text-white font-medium">Fluvoxamine inhibits CYP2C19 → clopidogrel cannot be activated</span>{' '}
            to its thiol metabolite. Antiplatelet effect drops. In a patient with a 9-month-old
            drug-eluting stent, this is a stent-thrombosis risk window. <span className="italic text-gray-400">
              Standard pairwise checkers do not flag clopidogrel + fluvoxamine.
            </span>
          </li>
          <li>
            <span className="text-white font-medium">Compound CYP3A4 inhibition</span>: fluvoxamine
            (moderate) plus residual ritonavir from a Paxlovid course completed 7 days ago (mechanism-based
            inhibition persists 3–4 days post-dose) plus atorvastatin (major CYP3A4 substrate) creates a
            window of statin AUC spike → rhabdomyolysis risk. A pairwise tool that turns off the Paxlovid
            alert at the end of the 5-day course misses this.
          </li>
          <li>
            <span className="text-white font-medium">Fluvoxamine inhibits CYP1A2 → tizanidine accumulation</span>.
            This pair <em>is</em> on most pairwise lists — included here as the contrast:
            the obvious miss the engine should also catch.
          </li>
        </ol>
        <p className="text-sm text-gray-400 mt-4 italic">
          Only multi-step reasoning over substrate ↔ inhibitor relationships, layered on patient context
          (post-DES, residual ritonavir, OCD indication for fluvoxamine), surfaces finding #1.
        </p>
      </section>

      <div className="flex flex-wrap gap-3">
        <Link
          href="/review/mr-patel-001"
          className="inline-flex items-center px-5 py-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold text-sm transition-colors"
        >
          Run medication review →
        </Link>
        <Link
          href="/comparison"
          className="inline-flex items-center px-5 py-2.5 rounded-lg border border-gray-700 text-gray-200 hover:bg-gray-900 text-sm transition-colors"
        >
          Pairwise vs. synthesis comparison
        </Link>
      </div>
    </div>
  );
}
