# Codex Review Prompt — PolyPharmGuard

Paste the block below into Codex (or any other reviewing agent) at the repo root.
It is self-contained: a fresh agent with no prior context should be able to act on it.

---

## Prompt

You are doing a one-shot end-to-end review of **PolyPharmGuard**, a clinical
polypharmacy reasoning engine submitted to the Agents Assemble hackathon
(deadline 2026-05-11). **Do not refactor or rewrite code.** Read, evaluate, and
report. Treat this like a senior staff engineer + clinical pharmacist
co-reviewing a high-stakes healthcare submission.

### What the project is

A Model Context Protocol (MCP) server exposing six clinical reasoning tools,
an A2A "MedReview Agent" that orchestrates them, a Next.js 16 web dashboard,
and a Python FastAPI ML risk scorer. Every clinical assertion must ground on
a verified knowledge base — never on LLM training knowledge. The
differentiator vs. legacy pairwise drug-interaction checkers is **multi-drug
CYP450 cascade reasoning with patient-specific context** (eGFR, conditions,
demographics).

### Architecture you must understand before judging anything

| Layer | Path | Notes |
|---|---|---|
| MCP server | `src/mcp-server/index.ts` | 6 tools registered, stdio + streamable-http transports |
| Tools | `src/mcp-server/tools/` | cascade, dosing, deprescribing, PD interactions, pharmacogenomics, lab monitoring |
| A2A agent | `src/a2a-agent/` | Thin orchestrator + `agent-card.json` |
| FHIR | `src/fhir/` | Client + queries; SHARP context extraction in `src/mcp-server/sharp/` |
| LLM | `src/llm/gemini.ts` | Optional — KB-only mode when `GEMINI_API_KEY` absent |
| Knowledge base | `src/knowledge-base/` | CYP450 substrates/inhibitors/inducers, Beers 2023, STOPPFrail, renal/hepatic dosing, PD interactions, PGx, lab monitoring |
| Audit | `src/audit/db.ts` | SQLite log of every tool call |
| Web | `web/app/` | 11 routes — `/`, `/batch`, `/cases/mr-patel`, `/comparison`, `/review/[id]`, `/patient-summary/[id]`, `/api/*` |
| ML scorer | `ml-service/` | FastAPI; logistic-regression-style composite score 0–100 |
| Tests | `tests/` | 90 vitest tests across tools, KB validation, e2e (Mrs. Johnson, Mr. Patel) |
| Demo assets | `demo/` | Script, narration, shot list — no recording yet |

Demo patients: **Mrs. Johnson** (78yo, 12 meds, eGFR 28 — renal/cascade-heavy)
and **Mr. Patel** (post-DES, clopidogrel + fluvoxamine — prodrug failure case).

### Setup before reviewing

```bash
npm install
npm run build
npm test
npm run validate:kb
cd web && npm install && npm run build && cd ..
```

All five must succeed. If any fails, that's finding #1 — stop and report.

### What to evaluate (in this order)

1. **Clinical correctness — non-negotiable**
   - Spot-check 5 random entries in `src/knowledge-base/cyp450/inhibitors.json`
     and `substrates.json` against FDA Drug Interactions Table classifications.
     Flag any entry whose `strength` or `enzyme` mapping is wrong.
   - Verify the **prodrug semantics** in `src/mcp-server/tools/cascade-interactions.ts`:
     a CYP2C19 inhibitor + clopidogrel must emit a **loss-of-efficacy** finding
     (clopidogrel needs CYP2C19 to activate), NOT a toxicity/dose-reduction
     finding. The Mr. Patel e2e test (`tests/e2e/mr-patel.test.ts`) is the
     guardrail — confirm it actually asserts clinical direction, not just
     "a finding exists."
   - Verify Beers 2023 entries (`src/knowledge-base/beers-criteria.json`) match
     the published AGS criteria — specifically PPI long-term use, gabapentinoid
     fall risk, and any anticholinergic entries.
   - Confirm renal dosing: metformin must be contraindicated at eGFR ≤ 30,
     gabapentin must have dose adjustment for eGFR 15–29.
   - **Citation discipline**: every finding produced by every tool should
     return a `source` field. Grep for findings constructed without one.

2. **Architectural integrity**
   - SHARP context propagation: confirm FHIR credentials flow via headers
     (`X-FHIR-Server-URL`, `X-FHIR-Access-Token`, `X-Patient-ID`) and **never
     appear in any LLM prompt** (`src/mcp-server/prompts/` or anywhere in
     `src/llm/`). This is a HIPAA-class concern.
   - Patient context is actually passed to tool handlers in the web review API
     (prior bug: dosing tool was silent because `patientContext` was dropped).
   - Audit logging fires for all 6 tool handlers (not just some).
   - The KB-only fallback path works — i.e., the system degrades gracefully
     without `GEMINI_API_KEY`, not silently broken.

3. **Code quality (TypeScript + Next.js 16)**
   - Type safety: any `any` casts in clinical-data paths are red flags.
   - Web app uses Next.js 16 patterns (App Router, Server Components,
     `outputFileTracingRoot` in `web/next.config.ts`). Note: `web/AGENTS.md`
     warns that this Next.js may diverge from training data — read
     `web/node_modules/next/dist/docs/` if you're unsure about an API.
   - Error handling at boundaries (FHIR fetch, LLM call) without swallowing
     clinical-finding errors.

4. **Test coverage gaps**
   - 90 tests pass — but what's *not* tested? Specifically look for:
     missing CYP3A4 cascade scenarios, hepatic dosing without eGFR, PGx
     edge cases (CYP2D6 ultra-rapid metabolizers), audit DB failure modes.
   - Are e2e tests asserting *clinical direction* or just *finding count*?

5. **Security & safety**
   - SQL injection / path traversal in audit DB or FHIR queries.
   - Any LLM prompt that interpolates raw patient data without redaction.
   - `.env` handling — confirm `.env` is gitignored and no real credentials
     are committed.
   - openFDA FAERS usage is enrichment-only (must not drive primary findings).

6. **Demo readiness (the hackathon is tomorrow)**
   - Does `demo/script.md` match what the running app actually shows?
     Boot the web app (`cd web && npm run dev`) and walk Mrs. Johnson +
     Mr. Patel routes — flag any drift between script and UI.
   - Does the README accurately describe what's shipped (no aspirational
     features)?

### Output format

Produce a single Markdown report with these sections — nothing else:

```
# PolyPharmGuard Review — <date>

## Verdict
One paragraph. Ship-ready / ship-with-caveats / blocker. Be direct.

## Critical findings (must fix before submission)
Numbered list. Each item: file:line, what's wrong, why it matters clinically
or operationally, suggested fix in 1–2 sentences. NO code rewrites.

## Important findings (should fix this week)
Same format.

## Nits / polish (optional)
Same format.

## What's done well
3–5 bullets. Keep judges' attention on real strengths.

## Test coverage gaps
Concrete missing scenarios with file paths where they'd live.

## Demo-readiness checklist
Pass/fail per item: build green, tests green, KB validates, web boots,
Mrs. Johnson route renders, Mr. Patel route renders, script matches UI,
README honest.
```

### Hard rules

- **Do not edit any files.** Read-only review.
- **Do not run `git` write operations** (commit, push, branch, reset).
- **Do not invent findings.** Cite `file:line` for every claim. If you can't
  cite it, drop it.
- **Do not hedge clinical correctness.** Wrong drug data = patient harm. Be
  blunt about errors and confident about correct entries.
- **Skip generic advice.** "Add more tests" is useless; "add a test at
  `tests/tools/cascade.test.ts` for CYP3A4 + statin + grapefruit context"
  is useful.
- **Time-box yourself to 45 minutes of review work.** This is for a hackathon
  due tomorrow, not a quarterly audit.

Begin.
