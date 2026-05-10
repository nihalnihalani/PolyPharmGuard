'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { RiskScoreGauge } from '@/components/RiskScoreGauge';
import { MedicationRiskMatrix } from '@/components/MedicationRiskMatrix';
import { EvidenceChainAccordion } from '@/components/EvidenceChainAccordion';
import { DrugInteractionGraph } from '@/components/DrugInteractionGraph';
import { ActionBar } from '@/components/ActionBar';
import { fadeUp, staggerContainer, criticalPulse } from '@/lib/motion';

// Loose types — page.tsx already validates the shape from /api/review.
// We keep them inline here so this file is self-contained for the polish pass.
interface RiskFactor {
  name: string;
  weight: number;
  evidence: string;
}
interface MatrixRow {
  medication: string;
  cascadeRisk: 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW' | 'OK' | 'INFO';
  pdRisk: 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW' | 'OK' | 'INFO';
  renalRisk: 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW' | 'OK' | 'INFO';
  hepaticRisk?: 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW' | 'OK' | 'INFO';
  pgxRisk?: 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW' | 'OK' | 'INFO';
  beersFlag: boolean;
  stoppfrailFlag?: boolean;
  labGap: boolean;
}
interface ChainStep {
  step: number;
  fact: string;
  source: string;
}
interface ActionableFinding {
  finding: string;
  severity: string;
  chain?: ChainStep[];
  clinicalConsequence?: string;
  recommendation?: string;
  toolName?: string;
}
interface InteractionEdge {
  from: string;
  to: string;
  severity: string;
  label: string;
  kind: 'cascade' | 'pd';
}

interface Props {
  patientId: string;
  patientName?: string;
  reviewId: string;
  medications: string[];
  riskScore: { score: number; interpretation?: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL'; band?: 'Low' | 'Moderate' | 'High' | 'Critical'; factors?: RiskFactor[]; method?: string; disclaimer?: string } | null;
  matrixRows: MatrixRow[];
  interactions: InteractionEdge[];
  allFindings: ActionableFinding[];
}

export function ReviewPageClient({
  patientId,
  patientName,
  reviewId,
  medications,
  riskScore,
  matrixRows,
  interactions,
  allFindings,
}: Props) {
  const actionable = allFindings.filter(f => f.severity !== 'LOW' && f.severity !== 'INFO');

  return (
    <motion.div
      className="space-y-6"
      initial="hidden"
      animate="show"
      variants={staggerContainer}
    >
      <motion.div className="flex items-center justify-between" variants={fadeUp}>
        <div>
          <h1 className="font-serif-display text-3xl text-white">{patientName ?? patientId}</h1>
          <p className="text-gray-400 text-sm">{medications.length} medications reviewed</p>
        </div>
        <div className="flex gap-3">
          <Link href={`/patient-summary/${patientId}`} className="text-sm text-accent-coral hover:underline">Patient Summary</Link>
          <Link href={`/api/reports/${reviewId}`} className="text-sm text-gray-400 hover:underline">PDF Report</Link>
        </div>
      </motion.div>

      <motion.div className="grid grid-cols-3 gap-6" variants={fadeUp}>
        <div className="col-span-1">
          {riskScore ? (
            <RiskScoreGauge
              score={riskScore.score}
              interpretation={riskScore.interpretation}
              band={riskScore.band}
              factors={riskScore.factors}
              method={riskScore.method}
              disclaimer={riskScore.disclaimer}
            />
          ) : (
            <div className="rounded-2xl border border-gray-800 p-6 text-center text-gray-500">Risk scoring unavailable</div>
          )}
        </div>
        <div className="col-span-2">
          <MedicationRiskMatrix rows={matrixRows} />
        </div>
      </motion.div>

      <motion.div variants={fadeUp}>
        <DrugInteractionGraph medications={medications} interactions={interactions} />
      </motion.div>

      <div>
        <motion.h2 className="font-serif-display text-2xl text-white mb-3" variants={fadeUp}>
          {actionable.length} Actionable Findings
        </motion.h2>
        <motion.div
          className="space-y-2"
          variants={staggerContainer}
        >
          {actionable.map((finding, i) => {
            const isCritical = finding.severity === 'CRITICAL';
            return (
              <motion.div
                key={i}
                variants={fadeUp}
                className="rounded-2xl border border-gray-800 p-4"
              >
                <div className="flex items-start gap-3">
                  {/* Severity badge — CRITICAL findings get the criticalPulse so
                      the eye lands on them in a long list. */}
                  <motion.span
                    className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold tracking-wider ${
                      isCritical ? 'bg-red-900 text-red-200' :
                      finding.severity === 'HIGH' ? 'bg-orange-900 text-orange-200' :
                      finding.severity === 'MODERATE' ? 'bg-yellow-900 text-yellow-200' :
                      'bg-gray-800 text-gray-300'
                    }`}
                    {...(isCritical ? criticalPulse : {})}
                  >
                    {finding.severity}
                  </motion.span>
                  <div className="flex-1 min-w-0">
                    <EvidenceChainAccordion findings={[{
                      finding: finding.finding,
                      severity: finding.severity,
                      chain: finding.chain ?? [],
                      clinicalConsequence: finding.clinicalConsequence ?? '',
                      recommendation: finding.recommendation ?? '',
                      toolName: finding.toolName,
                    }]} />
                  </div>
                </div>
                <ActionBar
                  reviewId={reviewId}
                  findingId={`finding_${i}`}
                  findingSummary={finding.finding}
                  severity={finding.severity}
                  toolName={finding.toolName}
                />
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </motion.div>
  );
}
