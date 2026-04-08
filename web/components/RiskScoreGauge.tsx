'use client';

interface RiskScoreGaugeProps {
  score: number;           // 0-100
  probability: number;     // 0.0-1.0
  interpretation: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
}

const COLORS = {
  LOW: 'text-green-400',
  MODERATE: 'text-yellow-400',
  HIGH: 'text-orange-400',
  CRITICAL: 'text-red-500',
};

const BG_COLORS = {
  LOW: 'bg-green-950 border-green-800',
  MODERATE: 'bg-yellow-950 border-yellow-800',
  HIGH: 'bg-orange-950 border-orange-800',
  CRITICAL: 'bg-red-950 border-red-800',
};

export function RiskScoreGauge({ score, probability, interpretation }: RiskScoreGaugeProps) {
  return (
    <div className={`rounded-xl border-2 p-6 text-center ${BG_COLORS[interpretation]}`}>
      <p className="text-sm text-gray-400 uppercase tracking-widest mb-2">90-Day Adverse Event Risk</p>
      <div className={`text-7xl font-black ${COLORS[interpretation]}`}>{score}</div>
      <div className={`text-2xl font-semibold mt-1 ${COLORS[interpretation]}`}>{interpretation}</div>
      <p className="text-gray-400 mt-2 text-sm">{(probability * 100).toFixed(0)}% probability of hospitalization</p>
      <div className="mt-4 bg-gray-800 rounded-full h-3 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-1000 ${
            interpretation === 'CRITICAL' ? 'bg-red-500' :
            interpretation === 'HIGH' ? 'bg-orange-400' :
            interpretation === 'MODERATE' ? 'bg-yellow-400' : 'bg-green-400'
          }`}
          style={{ width: `${score}%` }}
        />
      </div>
    </div>
  );
}
