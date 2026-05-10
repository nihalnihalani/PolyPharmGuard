'use client';

import { motion } from 'framer-motion';
import { fadeUp, staggerContainer } from '@/lib/motion';
import { BatchRow } from '@/components/BatchRow';

interface Snapshot {
  id: string;
  name: string;
  medCount: number;
  score: number | null;
  band: string | null;
  interpretation: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL' | null;
  error: boolean;
}

export function BatchPageClient({ snapshots }: { snapshots: Snapshot[] }) {
  return (
    <motion.div initial="hidden" animate="show" variants={staggerContainer}>
      <motion.div className="mb-6" variants={fadeUp}>
        <h1 className="font-serif-display text-3xl text-white">Pharmacist Review Queue</h1>
        <p className="text-gray-400 text-sm mt-1">
          Patients ranked by composite risk index -- review highest-risk first
        </p>
      </motion.div>
      <div className="space-y-3">
        {snapshots.map((patient, i) => (
          <BatchRow key={patient.id} patient={patient} isTop={i === 0} />
        ))}
      </div>
    </motion.div>
  );
}
