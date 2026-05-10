/**
 * Evidence gate for LLM-produced clinical findings.
 *
 * The cascade tool runs an algorithmic CYP450 detector grounded on the local
 * KB and *also* asks Gemini to surface anything the algorithm missed. The
 * problem: the LLM can hallucinate plausible-sounding cascades for drugs that
 * are not in the patient's medication list, or invent CYP relationships that
 * aren't actually in our KB. Per CLAUDE.md "every clinical assertion MUST cite
 * a source", an LLM finding without backing in the KB cannot be allowed to
 * carry a clinical severity claim.
 *
 * This module gates LLM findings against a candidate set computed from the
 * KB rows actually loaded for the patient's meds. A finding is "backed" if its
 * top-level `source` or any `chain[].source` string references a candidate
 * row's id (drug:enzyme:role tuple). Findings that don't match are demoted
 * to INFO with the "EXPLANATION ONLY:" prefix so they remain visible as
 * context but never escalate severity or trigger downstream actions.
 */

import type { CascadeFinding } from '../types/clinical.js';

/**
 * A single candidate row — built from inhibitions + substrate relationships
 * actually loaded from the KB for the patient's medication list. The id is a
 * canonical lower-case `drug:enzyme:role` tuple that LLM findings must reference
 * (in any of their source strings) to qualify as KB-backed.
 *
 * `tokens` is the lowercased substrings (drug name, enzyme name, role keyword,
 * source citation) — at least one of the drug/enzyme tokens must also appear in
 * the LLM finding's source/chain text for the finding to count as backed.
 */
export interface KBCandidate {
  id: string;            // e.g. "fluvoxamine:cyp2c19:strong_inhibitor"
  drug: string;          // e.g. "fluvoxamine"
  enzyme: string;        // e.g. "cyp2c19"
  role: string;          // e.g. "strong_inhibitor" or "major_substrate"
  sourceCitation: string; // exact KB source string for matching
}

export interface CandidateSet {
  rows: KBCandidate[];
  // Fast lookup: every drug name from the patient's KB matches.
  drugs: Set<string>;
  // Fast lookup: every enzyme touched by any candidate row.
  enzymes: Set<string>;
}

export function buildCandidateSet(rows: KBCandidate[]): CandidateSet {
  return {
    rows,
    drugs: new Set(rows.map(r => r.drug.toLowerCase())),
    enzymes: new Set(rows.map(r => r.enzyme.toLowerCase())),
  };
}

/**
 * Returns true when the finding's source/chain references any KB candidate row.
 * Match rules (any of):
 *  1. The finding's `source` or any `chain[].source` substring contains the
 *     candidate's `sourceCitation` text (exact match — KB rows are the
 *     source-of-truth strings).
 *  2. OR all three of (drug, enzyme, role) tokens appear in the combined
 *     finding text (finding + chain facts + sources). This handles the case
 *     where the LLM cited the FDA table by name without quoting verbatim.
 */
function findingMatchesCandidate(
  finding: CascadeFinding,
  candidate: KBCandidate
): boolean {
  const haystackParts = [
    finding.source ?? '',
    ...(finding.chain ?? []).map(s => s.source ?? ''),
  ];
  const haystack = haystackParts.join(' || ').toLowerCase();

  // Rule 1: exact KB source citation appears in any source string.
  if (candidate.sourceCitation && haystack.includes(candidate.sourceCitation.toLowerCase())) {
    return true;
  }

  // Rule 2: combined text contains all three identifying tokens.
  // We include the chain facts and the finding text itself in this check —
  // because "source" is sometimes truncated and the LLM puts the actual
  // identifying mechanism in the chain fact.
  const combined = (
    finding.finding + ' ' +
    (finding.clinicalConsequence ?? '') + ' ' +
    (finding.recommendation ?? '') + ' ' +
    (finding.chain ?? []).map(s => `${s.fact} ${s.source}`).join(' ') + ' ' +
    (finding.source ?? '')
  ).toLowerCase();

  const drugHit = combined.includes(candidate.drug.toLowerCase());
  const enzymeHit = combined.includes(candidate.enzyme.toLowerCase());
  // Role token can be split (e.g. "strong inhibitor" with a space, or "major
  // substrate"). Match on the role-stripped of underscores so both forms hit.
  const roleNorm = candidate.role.toLowerCase().replace(/_/g, ' ');
  const roleHit = combined.includes(roleNorm) || combined.includes(candidate.role.toLowerCase());

  return drugHit && enzymeHit && roleHit;
}

/**
 * Gate LLM findings against the KB candidate set.
 *
 * Behavior per finding:
 *  - If the finding matches at least one candidate row → keep as-is.
 *  - If the finding does NOT match any candidate row:
 *      - Demote to severity INFO
 *      - Prefix the `finding` text with "EXPLANATION ONLY:"
 *      - Append a note to clinicalConsequence stating it lacks KB backing
 *      - Keep the finding in the list — clinicians can still see the LLM's
 *        reasoning as context, just not as a clinical assertion.
 *
 * Exception: findings that already carry severity INFO (e.g. the algorithmic
 * "manual review required" stub) pass through unchanged — they're not making
 * a severity claim to demote.
 */
export function gateLLMFindings(
  llmFindings: CascadeFinding[],
  candidateSet: CandidateSet
): CascadeFinding[] {
  if (!Array.isArray(llmFindings) || llmFindings.length === 0) return [];

  const gated: CascadeFinding[] = [];

  for (const original of llmFindings) {
    // Already INFO — not making a clinical assertion, pass through.
    if (original.severity === 'INFO') {
      gated.push(original);
      continue;
    }

    const matched = candidateSet.rows.some(c => findingMatchesCandidate(original, c));

    if (matched) {
      gated.push(original);
      continue;
    }

    // Not backed by the KB — demote.
    const demoted: CascadeFinding = {
      ...original,
      severity: 'INFO',
      finding: original.finding.startsWith('EXPLANATION ONLY:')
        ? original.finding
        : `EXPLANATION ONLY: ${original.finding}`,
      clinicalConsequence: `${original.clinicalConsequence ?? ''}${original.clinicalConsequence ? ' ' : ''}[Note: this LLM-generated explanation could not be matched to a KB-row citation; it is shown for context only and does not constitute a clinical assertion.]`,
      source: `${original.source ?? ''}${original.source ? '; ' : ''}NOT_KB_BACKED — demoted by evidence gate (no matching candidate row)`,
    };
    gated.push(demoted);
  }

  return gated;
}
