'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { fadeUp, staggerContainer, cardHover, tapButton } from '@/lib/motion';

export default function HomePage() {
  return (
    <motion.div
      className="max-w-3xl mx-auto mt-12 space-y-10"
      initial="hidden"
      animate="show"
      variants={staggerContainer}
    >
      <motion.header className="text-center" variants={fadeUp}>
        <h1 className="font-serif-display text-5xl md:text-6xl text-white mb-4 tracking-tight">
          PolyPharm<span className="text-accent-coral">Guard</span>
        </h1>
        <p className="text-gray-400 text-lg">A pairwise drug-interaction checker would catch one of these.</p>
        <p className="text-red-400 font-semibold mt-1">A multi-enzyme reasoning engine catches the cascade that ends careers.</p>
      </motion.header>

      {/* Headline case — Mr. Patel */}
      <motion.section
        variants={fadeUp}
        whileHover={cardHover.whileHover}
        transition={cardHover.transition}
        className="bg-gradient-to-b from-red-950/20 to-gray-950 rounded-2xl border border-red-900/40 p-8"
      >
        <div className="flex items-center gap-2 mb-3">
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold border bg-red-900 text-red-300 border-red-700">
            AI FACTOR
          </span>
          <span className="text-xs text-gray-500 uppercase tracking-wider">Headline case</span>
        </div>
        <h2 className="font-serif-display text-3xl text-white mb-2">Mr. Raj Patel — 62yo, post drug-eluting stent</h2>
        <p className="text-gray-400 text-sm leading-relaxed mb-5 max-w-2xl">
          Newly started fluvoxamine for OCD. Recent Paxlovid course. Atorvastatin, clopidogrel, tizanidine.
          Renal and hepatic function are normal — pairwise checkers see two routine alerts. The cascade
          engine sees a three-step pharmacokinetic chain ending in stent thrombosis risk.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/review/mr-patel-001">
            <motion.div whileHover={tapButton.whileHover} whileTap={tapButton.whileTap} transition={tapButton.transition}>
              <Button size="lg" className="bg-accent-coral hover:bg-accent-coral-deep text-white font-bold px-7 shadow-[0_8px_30px_rgb(217_119_87_/_0.35)]">
                Run Medication Review
              </Button>
            </motion.div>
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
      </motion.section>

      {/* Companion case — Mrs. Johnson */}
      <motion.section
        variants={fadeUp}
        whileHover={cardHover.whileHover}
        transition={cardHover.transition}
        className="bg-gray-900 rounded-2xl border border-gray-800 p-6"
      >
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Companion case</p>
            <h3 className="font-serif-display text-2xl text-white">Mrs. Margaret Johnson — 78yo, eGFR 28, 12 medications</h3>
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
      </motion.section>
    </motion.div>
  );
}
