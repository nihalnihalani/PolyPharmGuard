import { Badge } from '@/components/ui/badge';

type SeverityOrOk = 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW' | 'OK' | 'INFO';

interface MatrixRow {
  medication: string;
  cascadeRisk: SeverityOrOk;
  pdRisk: SeverityOrOk;
  renalRisk: SeverityOrOk;
  beersFlag: boolean;
  labGap: boolean;
}

const CELL_STYLES: Record<string, string> = {
  CRITICAL: 'bg-red-900/80 text-red-300 font-bold',
  HIGH: 'bg-orange-900/60 text-orange-300',
  MODERATE: 'bg-yellow-900/40 text-yellow-300',
  LOW: 'bg-gray-800 text-gray-400',
  OK: 'bg-gray-900 text-gray-600',
  INFO: 'bg-blue-900/40 text-blue-300',
};

function Cell({ value }: { value: SeverityOrOk | boolean }) {
  if (typeof value === 'boolean') {
    return (
      <td className={`px-3 py-2 text-center text-xs ${value ? 'bg-orange-900/50 text-orange-300' : 'bg-gray-900 text-gray-600'}`}>
        {value ? 'YES' : '\u2014'}
      </td>
    );
  }
  return (
    <td className={`px-3 py-2 text-center text-xs ${CELL_STYLES[value] ?? CELL_STYLES.OK}`}>
      {value === 'OK' ? '\u2014' : value}
    </td>
  );
}

export function MedicationRiskMatrix({ rows }: { rows: MatrixRow[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-800">
      <table className="w-full text-sm">
        <thead className="bg-gray-900 border-b border-gray-800">
          <tr>
            <th className="px-4 py-3 text-left text-gray-400 font-medium">Medication</th>
            <th className="px-3 py-3 text-center text-gray-400 font-medium">CYP Cascade</th>
            <th className="px-3 py-3 text-center text-gray-400 font-medium">PD Risk</th>
            <th className="px-3 py-3 text-center text-gray-400 font-medium">Renal</th>
            <th className="px-3 py-3 text-center text-gray-400 font-medium">Beers</th>
            <th className="px-3 py-3 text-center text-gray-400 font-medium">Lab Gap</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800/50">
          {rows.map((row, i) => (
            <tr key={i} className="hover:bg-gray-900/50 transition-colors">
              <td className="px-4 py-2 font-medium text-gray-200">{row.medication}</td>
              <Cell value={row.cascadeRisk} />
              <Cell value={row.pdRisk} />
              <Cell value={row.renalRisk} />
              <Cell value={row.beersFlag} />
              <Cell value={row.labGap} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
