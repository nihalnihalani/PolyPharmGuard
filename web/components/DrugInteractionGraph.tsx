'use client';
import { useEffect, useRef } from 'react';
import type { Core, NodeDefinition, EdgeDefinition } from 'cytoscape';

const EDGE_COLORS: Record<string, string> = {
  CRITICAL: '#ef4444',
  HIGH: '#f97316',
  MODERATE: '#eab308',
  LOW: '#6b7280',
};

interface Interaction {
  from: string;
  to: string;
  severity: string;
  label: string;
  // Distinguishes cascade (PK / CYP) edges from pharmacodynamic edges so the
  // graph can render them with different line styles.
  kind?: 'cascade' | 'pd';
}

interface DrugInteractionGraphProps {
  medications: string[];
  interactions: Interaction[];
}

// Mirror of normalizeDrugName in src/mcp-server/tools/cascade-interactions.ts.
// Edge endpoints come from the API as already-normalized strings (e.g.
// "potassium chloride"), so node ids must derive from the same normalization
// or Cytoscape throws "edge references nonexistent target" for multi-word meds.
function normalizeDrugId(med: string): string {
  return med
    .toLowerCase()
    .trim()
    .replace(/\s*\d+\s*(mg|mcg|ml|meq|g)\s*(daily|bid|tid|once|twice|three times)?.*/i, '')
    .trim();
}

export function DrugInteractionGraph({ medications, interactions }: DrugInteractionGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    import('cytoscape').then(({ default: cytoscape }) => {
      if (cyRef.current) cyRef.current.destroy();

      const nodes: NodeDefinition[] = medications.map(med => ({
        data: {
          id: normalizeDrugId(med),
          label: normalizeDrugId(med),
        },
      }));

      const edges: EdgeDefinition[] = interactions
        .map((int, i) => ({
          data: {
            id: `e${i}`,
            source: normalizeDrugId(int.from),
            target: normalizeDrugId(int.to),
            label: int.label,
            severity: int.severity,
            kind: int.kind ?? 'pd',
            lineColor: EDGE_COLORS[int.severity] ?? EDGE_COLORS.LOW,
          },
        }))
        // Drop edges whose endpoints aren't in the node set (e.g. when a
        // contributing drug isn't in the rendered medication list). Cytoscape
        // throws otherwise.
        .filter(e => {
          const ids = new Set(nodes.map(n => n.data.id));
          return ids.has(e.data.source as string) && ids.has(e.data.target as string);
        });

      cyRef.current = cytoscape({
        container: containerRef.current,
        elements: { nodes, edges },
        style: [
          {
            selector: 'node',
            style: {
              'background-color': '#1f2937',
              'border-color': '#4b5563',
              'border-width': 2,
              'label': 'data(label)',
              'color': '#e5e7eb',
              'font-size': '12px',
              'text-valign': 'center',
              'text-halign': 'center',
              'width': 80,
              'height': 80,
            },
          },
          {
            selector: 'edge',
            style: {
              'line-color': 'data(lineColor)',
              'target-arrow-color': 'data(lineColor)',
              'target-arrow-shape': 'triangle',
              'curve-style': 'bezier',
              'width': 2,
              'label': 'data(label)',
              'font-size': '10px',
              'color': '#9ca3af',
              'text-rotation': 'autorotate',
            },
          },
          {
            // Cascade (PK) edges render solid + slightly thicker to set them apart
            // from pharmacodynamic edges visually.
            selector: 'edge[kind = "cascade"]',
            style: {
              'width': 3,
              'line-style': 'solid',
            },
          },
          {
            selector: 'edge[kind = "pd"]',
            style: {
              'line-style': 'dashed',
            },
          },
          {
            selector: ':selected',
            style: { 'background-color': '#3b82f6', 'border-color': '#60a5fa' },
          },
        ],
        layout: { name: 'cose', padding: 30, animate: false },
      });
    });

    return () => { cyRef.current?.destroy(); };
  }, [medications, interactions]);

  return (
    <div className="rounded-xl border border-gray-800 overflow-hidden">
      <div className="px-4 py-3 bg-gray-900 border-b border-gray-800 flex items-center justify-between">
        <span className="text-sm font-medium text-gray-300">Drug Interaction Network</span>
        <div className="flex gap-3 text-xs items-center">
          {Object.entries(EDGE_COLORS).map(([sev, color]) => (
            <span key={sev} className="flex items-center gap-1">
              <span className="w-3 h-0.5 inline-block" style={{ backgroundColor: color }} />
              <span className="text-gray-400">{sev}</span>
            </span>
          ))}
          <span className="ml-2 flex items-center gap-1">
            <span className="w-4 h-0.5 inline-block bg-gray-400" />
            <span className="text-gray-400">cascade (PK)</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-4 h-0.5 inline-block bg-gray-400" style={{ borderTop: '1px dashed #9ca3af', backgroundColor: 'transparent' }} />
            <span className="text-gray-400">PD</span>
          </span>
        </div>
      </div>
      <div ref={containerRef} style={{ width: '100%', height: '400px', background: '#030712' }} />
    </div>
  );
}
