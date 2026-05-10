'use client';

import { useEffect } from 'react';
import { motion, useMotionValue, useTransform, animate } from 'framer-motion';

/**
 * Score number that animates from 0 → value over 800ms on mount.
 *
 * Uses Framer Motion's useMotionValue + useTransform so the rounded integer
 * is rendered every frame without re-rendering React. Cheap, smooth, and
 * accessibility-friendly (the final value is a plain number once the
 * animation completes).
 */
interface Props {
  value: number;
  className?: string;
  durationMs?: number;
}

export function AnimatedScore({ value, className, durationMs = 800 }: Props) {
  const mv = useMotionValue(0);
  const rounded = useTransform(mv, (v) => Math.round(v));

  useEffect(() => {
    const controls = animate(mv, value, {
      duration: durationMs / 1000,
      ease: [0.16, 1, 0.3, 1],
    });
    return () => controls.stop();
  }, [value, durationMs, mv]);

  return <motion.span className={className}>{rounded}</motion.span>;
}
