# PolyPharmGuard — Shot List

Every screen capture needed to assemble the demo. Resolution target: **1920x1080 minimum**, recorded at 60fps.
Browser: Chrome (latest), profile with no extensions visible, zoom 110%.

> **App base URL during recording:** `http://localhost:3001` (Next.js dev). Mask the localhost port in the title bar — see `recording-checklist.md`. If you can run with a clean hostname (e.g. `polypharmguard.local` via /etc/hosts), prefer that.

---

## SHOT-01 — Mock Epic alert wall (motion graphic, NOT a real screen)

- **Type**: Static graphic / Keynote slide. NOT a real route.
- **Why**: We don't ship an Epic clone. This is the "before" world.
- **Composition**: 23 horizontal grey rows in a list. Each row has: drug pair name (e.g., "warfarin × simvastatin"), severity dot, "Override" radio button pre-selected, dismiss "X". Counter at top reads "23 interaction alerts — all dismissed".
- **Duration on screen**: 8 seconds
- **Asset format**: 1920x1080 PNG with subtle red flash overlay applied in editor

## SHOT-02 — Stat slam (motion graphic)

- **Type**: Three-card sequence
- **Composition**: Black bg, white type, one stat per card. Cards 1.5s each.
- **Stats**:
  - "95% — alert override rate in U.S. hospitals"
  - "1.3M — ER visits/yr from preventable ADEs"
  - "$30B — annual preventable cost"
- **Duration**: 12 seconds total
- **Sources** (footnotes for legal): Bates 2003 JAMIA (override rates), CDC ADE surveillance, ASHP cost studies. Tiny grey footer text.

## SHOT-03 — Landing page

- **URL**: `http://localhost:3001/`
- **Route file**: `web/app/page.tsx`
- **Viewport**: 1440x900 logical, full screen recording
- **Demo data prerequisite**: none
- **Cursor sequence**:
  1. Page idle for 1s
  2. Mouse drifts toward "Run Medication Review" red CTA
  3. Hover (do NOT click) — held 2s
- **What must be visible**: PolyPharmGuard logo, "23 alerts. The doctor ignored…" tagline, demo patient line, red CTA button
- **Duration on screen**: 10 seconds

## SHOT-04 — Pharmacist review queue

- **URL**: `http://localhost:3001/batch`
- **Route file**: `web/app/batch/page.tsx`
- **Viewport**: 1440x900
- **Demo data prerequisite**: `web/app/batch/page.tsx` is now a server component that fetches real scores from `/api/review/{id}` for the two real synthea patients (Mr. Patel, Mrs. Johnson) and sorts descending. With the prodrug-failure / residual-CYP3A4 / DAPT-at-risk factors landed, Mr. Patel renders **80 CRITICAL** above Mrs. Johnson **~74 CRITICAL**. Confirm with `curl http://localhost:3001/api/review/mr-patel | jq '.riskScore.score'` before record day. No vapor patients (John Doe / Jane Smith removed).
- **Cursor sequence**:
  1. Page loads, two patient cards visible
  2. Cursor hovers Mr. Patel's red 80 badge — 1s
  3. Cursor clicks "Review" button on Mr. Patel row
- **What must be visible**: title "Pharmacist Review Queue", two risk-ranked patient cards with real score badges
- **Duration on screen**: 10s queue view + transition

## SHOT-05 — Mr. Patel medication review (HERO SHOT)

- **URL**: `http://localhost:3001/review/mr-patel`
- **Route file**: `web/app/review/[patientId]/page.tsx`
- **Viewport**: 1440x900, but expect to scroll
- **Demo data prerequisite**: `data/synthea/mr-patel/` bundle is in place: patient.json (DOB 1963-09-12, age 62), medications.json (fluvoxamine 100mg, tizanidine 4mg, clopidogrel 75mg, completed Paxlovid course within last ~10 days, atorvastatin 40mg, lisinopril 20mg, metformin 1000mg, aspirin 81mg), conditions.json (T2DM, HTN, OCD, COVID resolved, post-DES, lumbar spasm), observations.json (eGFR 78, HbA1c 7.2). Risk score with new factors: **80 CRITICAL**.
- **Cursor sequence**:
  1. Page loads, gauge animates to 80 CRITICAL
  2. Pairwise-vs-PolyPharmGuard side-by-side overlay appears (this is an editing overlay added in post — NOT part of the live page)
  3. Cursor expands top finding in evidence accordion
  4. Cursor moves down each of 4 numbered chain steps
  5. Cursor scrolls smoothly to Cytoscape graph — wait for layout settle (1.5s)
  6. Cursor hovers a red cell in the Medication Risk Matrix to surface tooltip
- **What must be visible**: RiskScoreGauge (80 CRITICAL with named factors: CYP cascade HIGH x2, Prodrug activation failure, Residual CYP3A4 inhibitor window, DAPT at risk), Drug Interaction Graph with fluvoxamine → clopidogrel/tizanidine/atorvastatin edges, Medication Risk Matrix, Evidence Chain Accordion with numbered steps + FDA citations
- **Duration on screen**: 60 seconds (longest single shot)

## SHOT-06 — Mrs. Johnson medication review

- **URL**: `http://localhost:3001/review/mrs-johnson`
- **Route file**: `web/app/review/[patientId]/page.tsx`
- **Viewport**: 1440x900
- **Demo data prerequisite**: `data/synthea/mrs-johnson/` — VERIFIED PRESENT (medications.json has fluconazole + simvastatin among 12 meds, observations include eGFR 28)
- **Cursor sequence**:
  1. Page loads, gauge shows 74 CRITICAL
  2. Cursor expands the fluconazole → simvastatin cascade finding (4-step chain)
  3. Cursor scrolls to deprescribing finding for chronic PPI
  4. Cursor expands deprescribing → taper schedule template visible
- **What must be visible**: 12-medication count, eGFR 28 in citation chain, taper plan in template format
- **Duration on screen**: 15 seconds

## SHOT-07 — CDS Hooks integration (split-screen composite)

- **Type**: Two-source composite, assembled in editor
- **LEFT pane**: Mock Epic order entry screen. This is a static graphic — does NOT exist as a route. Composition: header "Order Entry — Mr. Patel", an "Add medication" search box with "tizanidine 4mg" entered, then a CDS Hooks card panel with red "critical" indicator, summary text "CYP1A2 cascade — fluvoxamine + tizanidine", and a "View full review" button.
- **RIGHT pane**: Postman or VSCode REST client showing:
  - Request: `POST http://localhost:3001/api/cds-hooks` body: `{"hook":"medication-prescribe","context":{"patientId":"mr-patel","medications":{...},"draftOrders":{...}}}`
  - Response: pretty-printed JSON `{"cards":[{"summary":"...","indicator":"critical","source":{"label":"PolyPharmGuard — CYP450 Cascade Analysis"}}]}`
- **Route file** (real, for the right pane): `web/app/api/cds-hooks/route.ts`
- **Cursor sequence**: cursor traces the JSON path on the right pane: `cards[0].source.label`
- **Duration on screen**: 15 seconds
- **Pre-record action**: capture the live POST response with curl/Postman, save as `demo/assets/cds-hooks-response.json` for reference

## SHOT-08 — Prompt Opinion marketplace listing

- **Type**: Real screen if access granted, otherwise high-fidelity mock
- **URL placeholder**: `https://app.promptopinion.ai/marketplace/agents`
- **What must be visible**: PolyPharmGuard tile, with: name, one-line description ("Clinical polypharmacy reasoning engine"), clinical-safety badge, install/invoke CTA, three MCP tool tags
- **Cursor sequence**: cursor clicks PolyPharmGuard tile
- **Duration**: 4 seconds
- See `marketplace-screenshots.md` for full spec

## SHOT-09 — Prompt Opinion agent invocation panel

- **URL placeholder**: `https://app.promptopinion.ai/marketplace/agents/polypharmguard`
- **What must be visible**: tool invocation panel showing `analyze_cascade_interactions` selected, request body with medications array, response with cited findings
- **Cursor sequence**: cursor highlights one citation source label in the response
- **Duration**: 3 seconds
- See `marketplace-screenshots.md`

## SHOT-10 — Architecture flash card (motion graphic)

- **Type**: Static graphic
- **Composition**: dark bg, four boxes connected left-to-right with arrows:
  - Box 1: "MCP Server" with sub-list: cascade, dosing, deprescribing, PD, lab-monitoring, pharmacogenomics
  - Box 2: "A2A MedReview Agent"
  - Box 3: "SHARP context — FHIR auth"
  - Box 4: "FHIR + Gemini reasoning"
- Bottom row tagline: "Every finding cites its source"
- **Duration on screen**: 10 seconds

## SHOT-11 — Logo card (closer)

- **Type**: Static graphic
- **Composition**: Centered PolyPharmGuard wordmark + Rx square logo. Below: team name. Bottom: GitHub URL, Devpost URL, "Built for Agents Assemble 2026". Tagline: "Reasoning, not warnings."
- **Duration**: 4–5 seconds with music fadeout

---

## Source-of-truth verification (cross-referenced against `web/app/`)

| Shot | Route exists? | Component(s) verified |
|------|--------------|----------------------|
| SHOT-03 `/` | YES | `web/app/page.tsx` |
| SHOT-04 `/batch` | YES | `web/app/batch/page.tsx` is now a server component that fetches real scores |
| SHOT-05 `/review/mr-patel` | YES | `web/app/review/[patientId]/page.tsx` reads from `/api/review/[patientId]`; bundle present at `data/synthea/mr-patel/` |
| SHOT-06 `/review/mrs-johnson` | YES | data verified at `data/synthea/mrs-johnson/` |
| SHOT-07 `/api/cds-hooks` | YES | `web/app/api/cds-hooks/route.ts` |

## Open dependencies for other agents

1. **Pairwise-vs-PolyPharmGuard side-by-side overlay** (Beat 2.1): can be done as a post-production graphic overlay if the route doesn't surface it natively. Demo Producer will assemble in editor.

## Recording order recommendation

To minimize app restarts:
1. SHOT-03, SHOT-04, SHOT-06, SHOT-05 (all real-app captures, in route order)
2. SHOT-07 right-pane (Postman) — separate window
3. SHOT-08, SHOT-09 (Prompt Opinion) — separate browser
4. Graphics (SHOT-01, SHOT-02, SHOT-07 left, SHOT-10, SHOT-11) — assembled in editor
