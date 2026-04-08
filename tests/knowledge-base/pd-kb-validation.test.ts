import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const KB_PATH = join(process.cwd(), 'src/knowledge-base/pd-interactions.json');

describe('PD Interactions KB', () => {
  it('loads and has correct structure', () => {
    const kb = JSON.parse(readFileSync(KB_PATH, 'utf-8'));
    expect(Array.isArray(kb)).toBe(true);
    expect(kb.length).toBeGreaterThan(5);
  });

  it('each entry has required fields', () => {
    const kb = JSON.parse(readFileSync(KB_PATH, 'utf-8'));
    for (const entry of kb) {
      expect(entry).toHaveProperty('id');
      expect(entry).toHaveProperty('class');
      expect(entry).toHaveProperty('drugClass');
      expect(entry).toHaveProperty('specificDrugs');
      expect(entry).toHaveProperty('severity');
      expect(entry).toHaveProperty('source');
      expect(Array.isArray(entry.specificDrugs)).toBe(true);
    }
  });

  it('has CNS_DEPRESSION class entry with opioids', () => {
    const kb = JSON.parse(readFileSync(KB_PATH, 'utf-8'));
    const cns = kb.filter((e: { class: string }) => e.class === 'CNS_DEPRESSION');
    expect(cns.length).toBeGreaterThan(0);
    const allDrugs = cns.flatMap((e: { specificDrugs: string[] }) => e.specificDrugs);
    expect(allDrugs.some((d: string) => d.includes('opioid') || d === 'oxycodone' || d === 'morphine')).toBe(true);
  });

  it('has QT_PROLONGATION class entry', () => {
    const kb = JSON.parse(readFileSync(KB_PATH, 'utf-8'));
    const qt = kb.filter((e: { class: string }) => e.class === 'QT_PROLONGATION');
    expect(qt.length).toBeGreaterThan(0);
  });
});
