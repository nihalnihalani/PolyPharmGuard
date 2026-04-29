import Link from 'next/link';

/**
 * Side-by-side comparison page demonstrating the "AI Factor".
 *
 * LEFT column: a simulated standard pairwise drug-interaction checker —
 * hardcoded list of what Lexicomp / Micromedex–style tools typically flag for
 * Mr. Patel's regimen. This is a rhetorical visualization, NOT a second engine.
 *
 * RIGHT column: PolyPharmGuard's multi-enzyme synthesis output. Server-side we
 * call the same /api/review endpoint that powers the demo review page so the
 * findings are real, cited, and refreshed on each render.
 */

interface CascadeFinding {
  finding: string;
  severity: string;
  chain?: { step: number; fact: string; source: string }[];
  clinicalConsequence?: string;
  recommendation?: string;
}

interface ReviewResponse {
  patientName: string;
  medications: string[];
  findings: { cascade?: CascadeFinding[] };
}

async function getReview(patientId: string): Promise<ReviewResponse | null> {
  const baseUrl = process.env['NEXT_PUBLIC_APP_URL'] ?? 'http://localhost:3001';
  try {
    const res = await fetch(`${baseUrl}/api/review/${patientId}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as ReviewResponse;
  } catch {
    return null;
  }
}

// Hardcoded "standard pairwise checker" output for Mr. Patel.
// Sources: what a typical pairwise tool would flag based on its drug-pair table.
// Calibrated to be REALISTIC, not strawmanned: tizanidine + fluvoxamine is on
// most lists; Paxlovid + atorvastatin is widely flagged historically.
const PAIRWISE_ALERTS = [
  {
    severity: 'CRITICAL',
    pair: 'Fluvoxamine + Tizanidine',
    summary: 'Contraindicated. Severe hypotension/bradycardia.',
    note: 'Standard pairwise interaction — flagged by most checkers.',
  },
  {
    severity: 'HIGH',
    pair: 'Paxlovid (ritonavir) + Atorvastatin',
    summary: 'Hold statin during Paxlovid course.',
    note: 'Pairwise-flagged during co-administration; checker assumes alert ends when Paxlovid is stopped.',
  },
];

const SEVERITY_BADGE: Record<string, string> = {
  CRITICAL: 'bg-red-900 text-red-300 border-red-700',
  HIGH: 'bg-orange-900 text-orange-300 border-orange-700',
  MODERATE: 'bg-yellow-900 text-yellow-300 border-yellow-700',
  LOW: 'bg-gray-800 text-gray-400 border-gray-700',
  INFO: 'bg-blue-900 text-blue-300 border-blue-700',
};

export default async function ComparisonPage() {
  const review = await getReview('mr-patel-001');

  // Show only cascade findings on synthesis side — those are what the pairwise
  // engine claims to cover. Filter out LOW/INFO so the comparison is fair.
  const synthesis = (review?.findings.cascade ?? []).filter(
    (f) => f.severity !== 'LOW' && f.severity !== 'INFO'
  );

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">AI Factor — Side by Side</p>
        <h1 className="text-3xl font-bold text-white">Pairwise Checker vs. Multi-Enzyme Synthesis</h1>
        <p className="text-gray-400 mt-2 max-w-3xl">
          Patient: <span className="text-white font-medium">Mr. Raj Patel (synthetic)</span>, 62yo,
          post drug-eluting stent, on fluvoxamine + clopidogrel + tizanidine + recent Paxlovid +
          atorvastatin. The same medication list, two different reasoning engines.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* PAIRWISE COLUMN */}
        <section className="rounded-xl border border-gray-800 bg-gray-950/50 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-800 bg-gray-900/40">
            <p className="text-xs text-gray-500 uppercase tracking-wider">Column A</p>
            <h2 className="text-xl font-semibold text-gray-200 mt-1">Standard Pairwise Checker</h2>
            <p className="text-xs text-gray-500 mt-2 italic">
              Simulated standard pairwise drug interaction checker output (Lexicomp / Micromedex-style
              lookup). Static example — not a live engine.
            </p>
          </div>
          <div className="p-5 space-y-3">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">
              {PAIRWISE_ALERTS.length} alerts
            </p>
            {PAIRWISE_ALERTS.map((a, i) => (
              <div key={i} className="rounded-lg border border-gray-800 p-4 bg-gray-950">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold border ${SEVERITY_BADGE[a.severity]}`}>
                    {a.severity}
                  </span>
                  <span className="text-sm font-medium text-gray-200">{a.pair}</span>
                </div>
                <p className="text-sm text-gray-300">{a.summary}</p>
                <p className="text-xs text-gray-600 italic mt-2">{a.note}</p>
              </div>
            ))}

            <div className="rounded-lg border border-gray-800 p-4 bg-gray-950 mt-4">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Not detected</p>
              <ul className="text-sm text-gray-500 space-y-1.5">
                <li className="flex gap-2">
                  <span className="text-gray-700">•</span>
                  <span>
                    Fluvoxamine + Clopidogrel — <span className="italic">not on standard pairwise lists</span>
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="text-gray-700">•</span>
                  <span>
                    Compound CYP3A4 inhibition (residual ritonavir + fluvoxamine) — pair-table can't model
                    additive enzyme load
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="text-gray-700">•</span>
                  <span>
                    Post-DES context (drug-eluting stent within 12 months) — not used to escalate severity
                  </span>
                </li>
              </ul>
            </div>
          </div>
        </section>

        {/* SYNTHESIS COLUMN */}
        <section className="rounded-xl border border-red-900/50 bg-gradient-to-b from-red-950/10 to-gray-950/50 overflow-hidden">
          <div className="px-5 py-4 border-b border-red-900/40 bg-red-950/20">
            <p className="text-xs text-red-400 uppercase tracking-wider">Column B</p>
            <h2 className="text-xl font-semibold text-white mt-1">PolyPharmGuard — Multi-Enzyme Synthesis</h2>
            <p className="text-xs text-gray-400 mt-2 italic">
              Live cascade analysis grounded on the local CYP450 knowledge base (FDA Drug Interactions
              Table 2024). Every step in every chain cites its source.
            </p>
          </div>
          <div className="p-5 space-y-3">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">
              {synthesis.length} cascade finding{synthesis.length === 1 ? '' : 's'}
            </p>
            {synthesis.length === 0 && (
              <div className="rounded-lg border border-gray-800 p-4 bg-gray-950 text-sm text-gray-500">
                Synthesis engine unavailable — start the dev server with{' '}
                <code className="text-gray-400">npm run dev</code> in <code>web/</code> and reload.
              </div>
            )}
            {synthesis.map((f, i) => (
              <details key={i} open={i < 2} className="rounded-lg border border-gray-800 p-4 bg-gray-950 group">
                <summary className="cursor-pointer list-none">
                  <div className="flex items-start gap-2">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold border ${SEVERITY_BADGE[f.severity] ?? SEVERITY_BADGE.LOW} shrink-0`}>
                      {f.severity}
                    </span>
                    <span className="text-sm font-medium text-gray-100 flex-1">{f.finding}</span>
                  </div>
                </summary>
                {f.chain && f.chain.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-800">
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Evidence Chain</p>
                    <div className="space-y-1.5">
                      {f.chain.map((step) => (
                        <div key={step.step} className="flex gap-3 text-sm">
                          <span className="text-gray-600 font-mono w-4 shrink-0">{step.step}.</span>
                          <div>
                            <span className="text-gray-300">{step.fact}</span>
                            <span className="ml-2 text-xs text-gray-600 italic">[{step.source}]</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {f.clinicalConsequence && (
                  <div className="mt-3 pt-3 border-t border-gray-800 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">
                        Clinical Consequence
                      </p>
                      <p className="text-gray-300">{f.clinicalConsequence}</p>
                    </div>
                    {f.recommendation && (
                      <div>
                        <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Recommendation</p>
                        <p className="text-gray-300">{f.recommendation}</p>
                      </div>
                    )}
                  </div>
                )}
              </details>
            ))}
          </div>
        </section>
      </div>

      <section className="rounded-xl border border-gray-800 bg-gray-950/50 p-6">
        <h3 className="text-base font-semibold text-white mb-2">Why this matters</h3>
        <p className="text-sm text-gray-400 leading-relaxed max-w-4xl">
          A pairwise checker can only reason about <em>drug A + drug B</em>. It cannot synthesize across
          three enzymes, recognize that fluvoxamine inhibits CYP2C19 — the very enzyme that{' '}
          <em>activates</em> clopidogrel into its thiol metabolite — and connect that to a 9-month-old
          drug-eluting stent that depends on full antiplatelet effect. That synthesis is the AI Factor:
          GenAI reasoning over a verified knowledge graph, with every step cited.
        </p>
        <div className="mt-4 flex gap-3">
          <Link
            href="/review/mr-patel-001"
            className="text-sm text-blue-400 hover:underline"
          >
            See the full review for Mr. Patel →
          </Link>
          <Link
            href="/cases/mr-patel"
            className="text-sm text-gray-500 hover:text-gray-300"
          >
            Case background
          </Link>
        </div>
      </section>
    </div>
  );
}
