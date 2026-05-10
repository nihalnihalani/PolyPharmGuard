'use client';

import { motion } from 'framer-motion';
import { AnimatedScore } from '@/components/AnimatedScore';

export interface RiskFactor {
  name: string;
  weight: number;
  evidence: string;
  category?: string;
}

interface RiskScoreGaugeProps {
  score: number;                       // 0-100
  /** Backward-compat band label (CAPS). Falls back to deriving from score. */
  interpretation?: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
  /** Title-case band returned by composite_heuristic_v1 (Low/Moderate/High/Critical). */
  band?: 'Low' | 'Moderate' | 'High' | 'Critical';
  factors?: RiskFactor[];
  method?: string;
  disclaimer?: string;
}

const COLORS = {
  LOW: 'text-green-400',
  MODERATE: 'text-yellow-400',
  HIGH: 'text-orange-400',
  CRITICAL: 'text-red-500',
} as const;

const BG_COLORS = {
  LOW: 'bg-green-950 border-green-800',
  MODERATE: 'bg-yellow-950 border-yellow-800',
  HIGH: 'bg-orange-950 border-orange-800',
  CRITICAL: 'bg-red-950 border-red-800',
} as const;

const BAR_COLORS = {
  LOW: 'bg-green-400',
  MODERATE: 'bg-yellow-400',
  HIGH: 'bg-orange-400',
  CRITICAL: 'bg-red-500',
} as const;

function deriveInterpretation(score: number): keyof typeof COLORS {
  if (score >= 75) return 'CRITICAL';
  if (score >= 50) return 'HIGH';
  if (score >= 25) return 'MODERATE';
  return 'LOW';
}

export function RiskScoreGauge({
  score,
  interpretation,
  band,
  factors = [],
  method = 'composite_heuristic_v1',
  disclaimer = 'Heuristic composite; not a validated clinical risk model. For research/demo use.',
}: RiskScoreGaugeProps) {
  const tone = interpretation ?? deriveInterpretation(score);
  const bandLabel = band ?? (tone.charAt(0) + tone.slice(1).toLowerCase());
  const sortedFactors = [...factors].sort((a, b) => b.weight - a.weight);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className={`rounded-2xl border-2 p-6 ${BG_COLORS[tone]} shadow-[0_8px_30px_rgb(0_0_0_/_0.4)]`}
    >
      <div className="text-center">
        <p className="text-xs text-gray-400 uppercase tracking-widest mb-2">
          Composite Risk Index
        </p>
        <div className={`font-serif-display text-7xl font-black ${COLORS[tone]}`}>
          <AnimatedScore value={score} />
        </div>
        <div className={`text-2xl font-semibold mt-1 ${COLORS[tone]}`}>{bandLabel}</div>
        <p className="text-gray-500 text-[11px] mt-1">out of 100 &middot; {method}</p>
        <div className="mt-4 bg-gray-800 rounded-full h-3 overflow-hidden">
          <motion.div
            className={`h-full rounded-full ${BAR_COLORS[tone]}`}
            initial={{ width: 0 }}
            animate={{ width: `${Math.min(score, 100)}%` }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
          />
        </div>
      </div>

      {sortedFactors.length > 0 && (
        <div className="mt-5">
          <p className="text-[11px] uppercase tracking-widest text-gray-400 mb-2">
            Contributing factors
          </p>
          <ul className="space-y-1.5">
            {sortedFactors.map((f, i) => (
              <li
                key={`${f.name}-${i}`}
                className="flex items-start justify-between gap-3 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-gray-100 font-medium truncate">{f.name}</div>
                  <div className="text-gray-400 text-xs truncate" title={f.evidence}>
                    {f.evidence}
                  </div>
                </div>
                <div
                  className={`flex-shrink-0 font-mono text-sm font-bold ${COLORS[tone]}`}
                  aria-label={`weight ${f.weight}`}
                >
                  +{f.weight}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-4 text-[10px] leading-snug text-gray-500 border-t border-gray-800 pt-3">
        {disclaimer}
      </p>
    </motion.div>
  );
}
