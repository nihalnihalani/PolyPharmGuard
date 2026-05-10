'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { fadeUp, cardHover } from '@/lib/motion';
import { AnimatedScore } from '@/components/AnimatedScore';

interface BatchRowPatient {
  id: string;
  name: string;
  medCount: number;
  score: number | null;
  band: string | null;
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

interface Props {
  patient: BatchRowPatient;
  isTop?: boolean;
}

export function BatchRow({ patient, isTop = false }: Props) {
  const tone = patient.interpretation ?? 'UNKNOWN';
  const badgeClass = BADGE_STYLES[tone] ?? BADGE_STYLES['UNKNOWN'];
  // Top row gets a subtle coral left-border to lead the eye for the demo —
  // composite-risk leader without being garish.
  const accentBorder = isTop ? 'border-l-2 border-l-accent-coral' : '';

  return (
    <motion.div
      variants={fadeUp}
      whileHover={cardHover.whileHover}
      transition={cardHover.transition}
      className={`rounded-2xl border border-gray-800 bg-gray-900 p-5 flex items-center gap-6 ${accentBorder}`}
    >
      <div className={`text-2xl font-black px-4 py-2 rounded-lg ${badgeClass}`}>
        {patient.score !== null ? <AnimatedScore value={patient.score} /> : '--'}
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
    </motion.div>
  );
}
