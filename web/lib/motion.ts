'use client';

/**
 * Shared Framer Motion variants for the PolyPharmGuard polish pass.
 *
 * Centralized so every animated component speaks the same motion language —
 * subtle, calm, clinical. Bias is toward small displacements and short
 * durations (≤350ms). The product is a clinical decision support tool;
 * animations are there to surface state and reward attention, not to
 * entertain.
 *
 * Variants:
 *   - fadeUp: opacity 0→1, y +8→0. Used for page entry and finding cards.
 *   - staggerContainer: yields a small staggered child reveal (~40ms).
 *   - cardHover: hover lift + tap shrink for interactive cards.
 *   - criticalPulse: a 2s scale loop for CRITICAL severity badges. Subtle
 *     enough to not annoy; loud enough to draw the eye to the highest-risk
 *     items in a long findings list.
 *   - tapButton: small tactile feedback on primary CTAs.
 */

import type { Variants, Transition } from 'framer-motion';

export const easeOut: Transition = { duration: 0.35, ease: [0.16, 1, 0.3, 1] };

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: easeOut },
};

export const staggerContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04, delayChildren: 0.05 } },
};

export const cardHover = {
  whileHover: { y: -2, scale: 1.005 },
  whileTap: { scale: 0.98 },
  transition: { type: 'spring' as const, stiffness: 300, damping: 22 },
};

export const criticalPulse = {
  animate: { scale: [1, 1.04, 1] },
  transition: { duration: 2, repeat: Infinity, ease: 'easeInOut' as const },
};

export const tapButton = {
  whileHover: { y: -1 },
  whileTap: { scale: 0.97 },
  transition: { type: 'spring' as const, stiffness: 400, damping: 25 },
};
