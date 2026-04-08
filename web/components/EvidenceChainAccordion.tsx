'use client';
import { useState } from 'react';

const SEVERITY_BADGE: Record<string, string> = {
  CRITICAL: 'bg-red-900 text-red-300 border-red-700',
  HIGH: 'bg-orange-900 text-orange-300 border-orange-700',
  MODERATE: 'bg-yellow-900 text-yellow-300 border-yellow-700',
  LOW: 'bg-gray-800 text-gray-400 border-gray-700',
  INFO: 'bg-blue-900 text-blue-300 border-blue-700',
};

interface ChainStep { step: number; fact: string; source: string }
interface Finding {
  finding: string;
  severity: string;
  chain: ChainStep[];
  clinicalConsequence: string;
  recommendation: string;
  toolName?: string;
}

export function EvidenceChainAccordion({ findings }: { findings: Finding[] }) {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <div className="space-y-2">
      {findings.map((finding, i) => (
        <div key={i} className="rounded-lg border border-gray-800 overflow-hidden">
          <button
            className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-gray-900/50 transition-colors"
            onClick={() => setOpen(open === i ? null : i)}
          >
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold border ${SEVERITY_BADGE[finding.severity] ?? SEVERITY_BADGE.LOW}`}>
              {finding.severity}
            </span>
            <span className="text-sm font-medium text-gray-200 flex-1">{finding.finding}</span>
            <span className="text-gray-600 text-xs">{open === i ? '\u25B2' : '\u25BC'}</span>
          </button>
          {open === i && (
            <div className="px-4 pb-4 bg-gray-950/50">
              {finding.chain.length > 0 && (
                <div className="mb-3 mt-2">
                  <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Evidence Chain</p>
                  <div className="space-y-1">
                    {finding.chain.map((step) => (
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
              <div className="grid grid-cols-2 gap-3 text-sm mt-3">
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Clinical Consequence</p>
                  <p className="text-gray-300">{finding.clinicalConsequence}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Recommendation</p>
                  <p className="text-gray-300">{finding.recommendation}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
