# Production Readiness Plan — 13 of 16 Codex Items

> **For Claude / teammates:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to execute your assigned tasks. Devil's advocate review (lead) is mandatory before each merge.

**Date:** 2026-05-10
**Target:** Hackathon submission (deadline 2026-05-11)
**Scope decision:** Approved by user — ship 13 items, defer 3 (5, 13, 14) with documented reasons.
**Coordination:** Polish-pass parallel session is paused for the duration of this work.

---

## Goal

Lift the project from "hackathon-grade with synthetic shortcuts" to "production-defensible". Replace silent fallbacks, plumb real FHIR context where SHARP headers arrive, harden the LLM evidence path, persist reviews, and tighten clinical wording — without regressing any of the demo-critical clinical findings (Mr. Patel prodrug failure, Mrs. Johnson cascade + dosing, audit trail, run.sh tracing).

## Architecture

Four parallel work streams (Wave 1) followed by one sequential stream (Wave 2). All work commits directly to `main` per CLAUDE.md auto-commit rule. Devil's advocate (lead) reviews every commit before pull request the next teammate. File ownership is partitioned to avoid merge conflicts; the one contended file (`web/app/api/review/[patientId]/route.ts`) is sequenced.

## Tech stack

- TypeScript 5.7, Node 20+, MCP SDK 1.12, Next.js 16 (webpack), Vitest 3
- FHIR R4 client (existing `src/fhir/client.ts`)
- Better-sqlite3 (existing audit; persistence layer reuses it)
- Gemini SDK (existing `src/llm/gemini.ts`)

## Coordination

### File ownership map

| Path | Owner | Touched in |
|---|---|---|
| `src/fhir/client.ts` | Dev 1 | Wave 1 |
| `src/fhir/queries.ts` | Dev 1 | Wave 1 |
| `src/fhir/pgx-queries.ts` (new) | Dev 3 | Wave 1 |
| `src/a2a-agent/orchestrator.ts` | Dev 1 | Wave 1 |
| `src/mcp-server/index.ts` (lab tool wiring) | Dev 1 | Wave 1 |
| `src/mcp-server/tools/cascade-interactions.ts` | Dev 2 | Wave 1 |
| `src/mcp-server/tools/pd-interactions.ts` | Dev 2 | Wave 1 |
| `src/mcp-server/tools/deprescribing-screen.ts` | Dev 3 | Wave 1 |
| `src/mcp-server/tools/organ-function-dosing.ts` | Dev 3 | Wave 1 |
| `src/mcp-server/tools/pharmacogenomics.ts` | Dev 3 | Wave 1 |
| `src/llm/evidence-gate.ts` (new) | Dev 2 | Wave 1 |
| `src/persistence/reviews.ts` (new) | Dev 4 | Wave 2 |
| `web/app/api/review/[patientId]/route.ts` | Dev 1 (FHIR) → Dev 4 (persistence + risk-score) | Sequential |
| `web/app/api/reports/[reviewId]/route.tsx` | Dev 4 | Wave 2 |
| `web/app/review/[patientId]/page.tsx` | Dev 4 (matrix) | Wave 2 |

### Wave order

- **Wave 1 (parallel, no contended files):** Dev 1, Dev 2, Dev 3
- **Wave 2 (after Dev 1 has merged FHIR hydration into `route.ts`):** Dev 4

### Devil's advocate gates

Devil's Advocate (Lead, Opus) MUST review and approve before any teammate's commit ships:

- [ ] No regression in `npm test` (90/90 baseline)
- [ ] `npm run build` clean in root and `web/`
- [ ] `npm run validate:kb` passes
- [ ] No new `any` casts in clinical-data paths
- [ ] No PHI ever appears in LLM prompts (re-check `ensureNoFHIRCredentials`)
- [ ] Clinical-direction-specific tests still pass (Mr. Patel prodrug = LOSS not toxicity; Mrs. Johnson omeprazole no false renal escalation)
- [ ] Run.sh boots all four services without error after each merge
- [ ] Each new tool path covered by at least one unit test
- [ ] Adversarial test added per major change (devil's advocate writes one)

If any gate fails: STOP, kick back to teammate with specific diff/file/line, do not merge.

---

## Wave 1: Parallel Work (3 teammates)

### Tool Dev 1 — FHIR Hydration Trio

**Items:** 1 (web FHIR), 2 (A2A FHIR), 4 (lab-monitoring FHIR)

**Files:**
- Modify: `src/fhir/queries.ts` — add `loadPatientBundle(client, patientId)` aggregating Patient + MedicationRequest + Observation + Condition
- Modify: `src/fhir/client.ts` — add timeout + AbortController per request, retry-once on 5xx
- Modify: `src/a2a-agent/orchestrator.ts:57` — when only `patientId` + `fhirContext` provided, call `loadPatientBundle()` and populate `medications/observations/conditions`
- Modify: `web/app/api/review/[patientId]/route.ts:40` — branch on inbound SHARP headers (`X-FHIR-Server-URL` etc.):
  - If present: call `loadPatientBundle()` and use that data
  - If absent AND patientId matches "patel"/"johnson": fall back to synthea fixtures (current behavior)
  - If absent AND patientId is unknown: return 404 with structured error (no silent Mrs. Johnson)
- Modify: `src/mcp-server/index.ts:291` — `check_lab_monitoring` handler: when `fhirContext` present and `recentLabs` empty, fetch Observations via `loadPatientObservations(client, patientId, sinceDays=180)`

**Tests:**
- Add: `tests/fhir/loadPatientBundle.test.ts` — uses mocked fetch to verify aggregation
- Add: `tests/api/review-route.test.ts` — three cases:
  - SHARP headers present → uses FHIR data
  - No SHARP, known synthetic patient → uses fixture
  - No SHARP, unknown patient → returns 404 with `{ error, code: 'PATIENT_NOT_FOUND' }`
- Add: `tests/tools/lab-monitoring-fhir.test.ts` — verifies Observation fetch when fhirContext present

**Acceptance criteria:**
- A SMART-on-FHIR launch hitting `/api/review/abc-123` with valid SHARP headers returns a real review using fetched data
- Unknown patient ID without SHARP returns 404, not Mrs. Johnson
- A2A `/tasks/send` with `{patientId, fhirContext}` and no inline data still produces a complete review
- All existing tests still pass; no regression in Mr. Patel/Mrs. Johnson e2e

**Devil's advocate adversarial test (lead writes):**
- FHIR server returns 503 → request id propagates, error response structured, no crash
- FHIR server returns malformed Bundle → graceful fallback or error, no exception

---

### Tool Dev 2 — Clinical Evidence + Cascade Wording

**Items:** 6 (RxNorm/ingredient parsing), 7 (LLM gated to KB-row refs), 8 (PD wording specificity)

**Files:**
- Create: `src/llm/evidence-gate.ts` — exports `gateLLMFindings(llmFindings, kbCandidateSet)`:
  - Each LLM finding must reference an entry in the candidate set by exact (drug, enzyme, role) tuple
  - Strip findings whose source citation doesn't match a KB row id present in the candidate set
  - Demote unmatched findings to "explanation only" — no clinical assertion claims
- Modify: `src/mcp-server/tools/cascade-interactions.ts:351` — wrap LLM merge with `gateLLMFindings(llmFindings, candidateSet)`. Build candidateSet from inhibitions + substrate relationships actually loaded
- Modify: `src/mcp-server/tools/cascade-interactions.ts:89` — replace `normalizeDrugName` with `parseRxNormProduct(name)`:
  - Recognize combination products (Paxlovid → nirmatrelvir + ritonavir; Sinemet → carbidopa + levodopa)
  - Return `{ ingredients: string[], dose?: number, unit?: string, frequency?: string }`
  - Match each ingredient against KB independently
  - Add `data/rxnorm/combo-products.json` — minimal table of common combo products → ingredient lists (start with Paxlovid, Sinemet, Lisinopril/HCTZ, Bactrim, Norco)
- Modify: `src/mcp-server/tools/pd-interactions.ts:57` — replace generic mechanism wording with class-pair-specific findings:
  - SSRI + DAPT → "Increased bleeding risk: SSRI inhibits platelet serotonin reuptake on top of DAPT"
  - NSAID + anticoagulant → "Increased GI/major bleeding: NSAID + anticoagulant"
  - Antiplatelet + anticoagulant → "Triple therapy bleeding risk"
  - QT-prolongers stacked → list specific drugs and cumulative QT effect
  - Use a switch on `(class, contributingDrugClasses[])` rather than generic mechanism string

**Tests:**
- Add: `tests/llm/evidence-gate.test.ts`:
  - LLM finding referencing KB row in candidate set → kept
  - LLM finding referencing nonexistent row → stripped
  - LLM finding with vague source → demoted to explanation, no severity claim
- Add: `tests/tools/rxnorm-parsing.test.ts`:
  - "Paxlovid" → splits to nirmatrelvir + ritonavir
  - "Lisinopril/HCTZ 20-12.5" → splits to lisinopril + hydrochlorothiazide
  - "Atorvastatin 40mg PO daily" → ingredient atorvastatin, dose 40, freq daily
- Modify: `tests/tools/pd-interactions.test.ts` — assert finding text differs by drug pair (not generic class wording)

**Acceptance criteria:**
- LLM findings without KB-row backing don't ship as clinical assertions
- Mr. Patel's Paxlovid is correctly decomposed into nirmatrelvir + ritonavir; ritonavir is the strong CYP3A4 inhibitor that fires the residual-window factor
- PD interaction findings are pair-specific, not generic-mechanism

**Devil's advocate adversarial test (lead writes):**
- LLM hallucinates a finding for a drug not in the patient's medication list → must be stripped
- Combination product whose ingredients are unknown to KB → manual-review finding with all ingredients listed, not silent skip

---

### Tool Dev 3 — Deprescribing + Renal Dose + PGx Ingestion

**Items:** 3 (PGx genotype ingestion), 9 (deprescribing condition suppression), 10 (renal dose parsing from FHIR dosageInstruction)

**Files:**
- Create: `src/fhir/pgx-queries.ts` — exports `loadPatientGenotypes(client, patientId)`:
  - Fetch FHIR Observations with category `laboratory` and code matching CPIC/PharmGKB pgx LOINC codes (e.g. `54091-9` CYP2D6 phenotype, `79716-7` CYP2C19 phenotype)
  - Return `Record<gene, phenotype>` — e.g. `{ "CYP2D6": "poor_metabolizer", "CYP2C19": "intermediate_metabolizer" }`
  - Also accept structured input via existing `genotypes` field on review request as fallback
- Modify: `web/app/api/review/[patientId]/route.ts:102` — populate `genotypes` from `loadPatientGenotypes()` when SHARP context present (coordinate with Dev 1)
- Modify: `src/mcp-server/tools/deprescribing-screen.ts:77` — add condition+time-aware suppression:
  - Statin + (CAD OR diabetes OR post-MI) → suppress deprescribing recommendation, add INFO note "Active secondary prevention indication"
  - Aspirin + (post-DES within 12mo OR active CAD) → suppress
  - Clopidogrel/Prasugrel/Ticagrelor + (post-DES within 12mo) → suppress; flag instead "Continue per DAPT protocol"
  - Metformin + active diabetes + eGFR > 30 → suppress (active appropriate use)
  - PPI + (active GI bleed OR Barrett's OR chronic NSAID + age >65) → suppress
  - Use existing `hasDocumentedIndication` helper as base; add explicit indication categories
- Modify: `src/mcp-server/tools/organ-function-dosing.ts:171` — replace name-only matching with dose parsing:
  - Parse FHIR `dosageInstruction` to extract daily dose: `doseQuantity.value × frequency`
  - Compare daily dose against renal-adjusted ceiling per eGFR band
  - Add `actualDailyDose` and `recommendedDailyMaxAtEgfr` to the finding
  - Example: Gabapentin 300mg TID → 900mg/day; eGFR 28 → ceiling 300mg/day → flag with concrete numbers, not just "requires attention"

**Tests:**
- Add: `tests/fhir/pgx-queries.test.ts` — verify CYP2D6 and CYP2C19 phenotype extraction from mocked Observation bundle
- Modify: `tests/tools/deprescribing.test.ts` — add cases:
  - Aspirin + active CAD → not deprescribed
  - Metformin + diabetes + eGFR 50 → not deprescribed
  - Statin + CAD → not deprescribed but DOES include note
  - Clopidogrel + post-DES within 6 months → suppressed with DAPT note
- Modify: `tests/tools/dosing.test.ts` — add cases:
  - Gabapentin 300mg TID + eGFR 28 → finding includes "actual 900mg/day exceeds ceiling 300mg/day"
  - Same drug at 100mg daily + same eGFR → no finding (under ceiling)
- Modify: `tests/tools/pharmacogenomics.test.ts` — add case loading genotypes from mocked FHIR

**Acceptance criteria:**
- Mr. Patel still deprescribes Aspirin (his case has post-DES; verify suppression vs. severity)
- Wait — actually Mr. Patel SHOULD have his clopidogrel/aspirin **kept** for DAPT (post-DES). Deprescribing suppression is required. Verify after change.
- Mrs. Johnson still gets PPI deprescribing recommendation (no Barrett's, no chronic NSAID)
- Gabapentin finding for Mrs. Johnson now shows concrete daily-dose math
- A patient with CYP2D6 poor metabolizer phenotype in their FHIR labs gets the codeine warning automatically

**Devil's advocate adversarial test (lead writes):**
- A statin + CAD + active rhabdomyolysis lab → suppression must NOT fire; rhabdo overrides indication
- Gabapentin parsing handles "300mg PO TID PRN for pain" without crashing
- PGx Observation with malformed code → graceful skip, no crash

---

## Wave 2: Sequential (after Dev 1 merges)

### Tool Dev 4 — Persistence + Risk-Score Hardening + Matrix + PDF

**Items:** 11 (risk-score URL/timeout/env), 12 (persisted reviews), 15 (matrix all meds + full severity), 16 (PDF all findings)

**Files:**
- Create: `src/persistence/reviews.ts`:
  - SQLite-backed (reuses `src/audit/db.ts` connection)
  - Schema: `reviews(id PK, patient_id, created_at, inputs_json, outputs_json, scorer_version, app_version)`
  - Functions: `saveReview(snapshot)`, `loadReview(id)`, `listReviews(patientId)`
- Modify: `web/app/api/review/[patientId]/route.ts`:
  - **Item 11 (risk-score config):**
    - URL from `process.env.NEXT_PUBLIC_RISK_SCORE_URL ?? 'http://localhost:8001'`
    - Wrap fetch with `AbortController` + 3-second timeout
    - On timeout/connection-refused: return `riskScore: { unavailable: true, reason: 'risk-score-service-down' }` (not silent null)
  - **Item 12 (persistence):**
    - After computing the review, call `saveReview({ id: reviewId, patientId, inputs, outputs, scorerVersion, appVersion })`
    - Return the persisted reviewId
- Modify: `web/app/api/reports/[reviewId]/route.tsx:76` — fetch from `loadReview(reviewId)` instead of recomputing; render ALL actionable findings (no slice 10); footer disclaimer always shown
- Modify: `web/app/review/[patientId]/page.tsx:102` — risk matrix:
  - Render ALL medications (remove `.slice(0, 8)`)
  - Show tool-specific severity per cell (PGx, hepatic, lab-monitoring, STOPPFrail flags as separate columns)
  - Use a min-width wrapper if the row count is large

**Tests:**
- Add: `tests/persistence/reviews.test.ts` — round-trip a snapshot
- Add: `tests/api/risk-score-timeout.test.ts` — mock fetch to hang; expect 3s abort and structured `unavailable` response
- Add: `tests/api/reports-route.test.ts` — verify report renders all findings from persisted snapshot

**Acceptance criteria:**
- ML scorer down → `riskScore.unavailable === true` with reason; page renders gracefully
- A second GET to the same `reviewId` returns the same data (idempotent persistence)
- PDF report includes all actionable findings, not just first 10
- Matrix shows all 12 of Mrs. Johnson's meds with full severity

**Devil's advocate adversarial test (lead writes):**
- Persistence write fails (disk full) → request still completes; error is logged with reqId; user sees the live review even if not stored
- Reading a non-existent reviewId → 404, no crash

---

## Deferred items (with documented reasons)

### Item 5 — Cascade enzyme-graph reasoning

**Why deferred:** This is a research problem, not a refactor. There is no consensus algorithm in the literature for cumulative enzyme burden, competing inhibition/induction, or multi-inhibitor stacking that's safe for clinical decision support. Commercial pairwise checkers all stop at pairwise for the same reason. The current pairwise + prodrug logic took multiple debugging rounds to land correctly (see commits 1de4d79, 3e39ba2, 3de0521, 5b1d56e, 14ec248); a rushed v2 risks regressing the Mr. Patel prodrug-failure case which is the demo's hero finding.

**Next step:** Land a v2 design doc post-hackathon; pilot the enzyme-graph approach against a held-out test set before shipping.

### Item 13 — Managed audit store, retention, encryption

**Why deferred:** Requires a hosting target decision (managed Postgres, GCP Logging, AWS CloudTrail, or an EHR-side audit log). Without that decision, the implementation is just code that points nowhere. The current SQLite audit is honest about being local-only.

**Next step:** Decide hosting; design retention policy + encryption-at-rest pattern; implement against the chosen target.

### Item 14 — Real SMART-on-FHIR / OIDC auth

**Why deferred:** Requires a real identity provider configured for the deployment environment. Shipping a stub auth that *looks* like real auth would be worse than the current honest `demo_clinician` default — it gives false assurance.

**Next step:** Pick IdP (Okta, Auth0, Epic SMART-on-FHIR sandbox); wire OIDC discovery; replace `demo_clinician` default with session-backed identity.

---

## Verification before completion (whole bundle)

After all 13 items merge:

1. `npm run build` clean in root + `web/`
2. `npm test` 90/90 baseline + new tests added in this work all green
3. `npm run validate:kb` passes
4. `./run.sh --no-tail` boots all four services; trace IDs propagate
5. Browser walk:
   - `/batch` shows both patients ranked correctly (Mr. Patel first)
   - `/review/mr-patel-001` — top finding still CRITICAL prodrug-failure of clopidogrel via fluvoxamine CYP2C19
   - `/review/mrs-johnson` — fluconazole→simvastatin cascade present; metformin contraindicated; PPI deprescribing fires
   - Risk matrix shows all 12 meds for Mrs. Johnson, full severity per column
   - PDF report includes every actionable finding
6. Adversarial verification:
   - Hit `/api/review/unknown-patient-xyz` without SHARP headers → 404 (not silent Mrs. Johnson)
   - Stop ML service, hit `/api/review/mr-patel` → page renders, riskScore.unavailable === true
   - Send `X-Request-Id: trace-prod-test` → echoed back in response, present in `web-api` log
7. Re-run polish-pass session against the new foundation

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Wave 1 agents conflict on `route.ts` | Low (sequenced) | High | Strict file ownership, sequence Dev 4 after Dev 1 |
| Cascade evidence gating drops the Mr. Patel prodrug finding | Medium | Critical | Adversarial test with Mr. Patel data BEFORE merging Dev 2 |
| Deprescribing suppression too aggressive | Medium | Critical | Adversarial test with rhabdo-override case BEFORE merging Dev 3 |
| FHIR hydration breaks fixture-based demo | Low | High | Keep synthea-fallback branch; test all three paths |
| Persistence writes fail silently | Low | Medium | Devil's advocate adversarial test for write-failure case |
| Clock-running-out on Wave 2 | Medium | Medium | Wave 2 items are independent; ship what's done by morning |

## Done condition

- All 13 items committed and pushed to `main`
- All devil's advocate gates pass for each merge
- Full verification checklist above passes
- Polish-pass session restarted against the new foundation (or deferred consciously)
- Deferred items 5, 13, 14 have design notes in this plan; user confirms the deferral
