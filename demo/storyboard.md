# PolyPharmGuard — Demo Storyboard

20 frames mapped to the 2:30 script. Use this as the editing timeline.

| # | Time | Frame | Visual | Narration excerpt | Notes |
|---|------|-------|--------|-------------------|-------|
| 01 | 0:00–0:08 | Cold open | Full-screen mock Epic alert wall — 23 grey rows, all "overridden". Subtle red flash on counter | "Twenty-three alerts. The doctor ignored every single one. Three could have killed her." | No motion graphics — flat, clinical, scary |
| 02 | 0:08–0:14 | Stat 1 | Black background, white type: "95% override rate" | "Ninety-five percent of EHR drug alerts are overridden." | Type-on animation, 0.5s |
| 03 | 0:14–0:17 | Stat 2 | "1.3M annual ER visits from ADEs" | "One-point-three million emergency visits a year" | Same style as Stat 1 |
| 04 | 0:17–0:20 | Stat 3 | "$30B preventable cost" | "Thirty billion dollars in preventable harm." | Hold 1 sec at end |
| 05 | 0:20–0:30 | Product reveal | PolyPharmGuard landing `/`. Logo, tagline, red CTA visible. Cursor hovers CTA | "PolyPharmGuard replaces the alert wall with cited clinical reasoning." | Title bar must NOT show localhost port — see recording-checklist |
| 06 | 0:30–0:42 | Patient queue | `/batch` page. Mr. Patel row at top, 80 CRITICAL; Mrs. Johnson below. Cursor moves to his Review button | "Meet Mr. Patel. Sixty-two, on fluvoxamine, tizanidine, clopidogrel." | DEMO DATA: real synthea bundles for both patients |
| 07 | 0:42–0:55 | Pairwise vs PolyPharmGuard | `/review/mr-patel`. Risk gauge spins to 80. Side-by-side overlay: "Pairwise: 0 critical" vs "PolyPharmGuard: 4 cited findings" | "Every pairwise checker passed him. Ours didn't." | THE AI FACTOR money shot. Hold 3+ sec |
| 08 | 0:55–1:10 | Evidence chain expand | Click top finding. Four numbered steps each with `[FDA Table]` citations | "Fluvoxamine is a strong CYP1A2 inhibitor. Tizanidine is metabolized by CYP1A2. AUC goes up tenfold." | Cursor moves down each line as drug is named |
| 09 | 1:10–1:20 | Synergistic risk | Continue expanding chain. Steps 3 & 4 visible with ritonavir + clopidogrel prodrug-failure note | "Residual ritonavir blocking CYP3A4, plus clopidogrel — fluvoxamine also blocks its bioactivation." | Linger on the FDA citation tag |
| 10 | 1:20–1:28 | Risk gauge zoom | Zoom into composite risk gauge. Named factors visible: CYP cascade x2, prodrug failure, residual CYP3A4 window, DAPT at risk | "Composite risk index" | Use Premiere/FCP zoom keyframe — no in-app animation |
| 11 | 1:28–1:32 | Cytoscape graph | Drug interaction graph: edges from fluvoxamine to clopidogrel, tizanidine, atorvastatin | "Drug interaction graph" | Wait for layout to settle before recording |
| 12 | 1:32–1:35 | Risk matrix | Medication risk matrix table, hover one red cell to surface tooltip with citation | "Every red cell links back to a citation." | Cursor hover must hold 1.5s to make tooltip readable |
| 13 | 1:35–1:50 | Mrs. Johnson | `/review/mrs-johnson`. Risk 74 CRITICAL. Cursor expands fluconazole→simvastatin chain, then deprescribing taper | "Fluconazole inhibiting CYP3A4 spikes her simvastatin three-fold, with renal impairment amplifying rhabdomyolysis. Plus a four-week PPI taper." | Two distinct expansions, ~6s each |
| 14 | 1:50–2:00 | Pharmacist queue | `/batch` again. Two real patients ranked by composite risk index — Mr. Patel 80 above Mrs. Johnson | "Pharmacists triage by risk, not by alphabet." | Cursor highlights the risk badge column |
| 15 | 2:00–2:15 | CDS Hooks split | Left: mock Epic order screen with critical CDS card. Right: `POST /api/cds-hooks` JSON response | "We ship as standard HL7 CDS Hooks. No custom integration." | JSON must be syntax-highlighted, dark theme |
| 16 | 2:15–2:22 | Marketplace listing | Prompt Opinion marketplace tile for PolyPharmGuard | "Discoverable, invocable, billable inside Prompt Opinion." | Real or high-fidelity mock — see marketplace-screenshots.md |
| 17 | 2:22–2:25 | Marketplace tool call | Tool invocation panel showing `analyze_cascade_interactions` request + cited response | "SHARP context flows in. Findings flow back." | Quick — under 3s |
| 18 | 2:25–2:35 | Architecture card | Single dark slide. Four boxes: MCP Server (6 tools) → A2A Agent → SHARP → FHIR+Gemini | "Six MCP tools. One A2A orchestrator. Every finding cites its source." | Static graphic — Keynote/Figma export |
| 19 | 2:35–2:50 | Closing punch | Cut back to Mr. Patel review, freeze on the four-step evidence chain. Tagline types in: "Reasoning, not warnings." | "Twenty-three alerts is alert fatigue. Three cited findings is medicine." | Closing line should land EXACTLY on the freeze frame |
| 20 | 2:50–2:55 | Logo + URLs | PolyPharmGuard logo, team name, GitHub URL, Devpost URL | (silent) | Hold 4–5s. Music tail-out |

## Editing notes

- **Music**: ducked under VO entirely. Lift slightly for stat slam (frames 2–4) and architecture card (frame 18).
- **Color grade**: keep the dark UI as-is. The product palette IS the brand.
- **Cuts**: hard cuts only. No fade transitions except logo card at end.
- **Cursor**: 110% size, yellow glow on click for visibility on Devpost thumbnail.
- **Title-safe area**: Devpost embed crops 8% on each side — keep critical text away from edges.

## Frame-to-shot crosswalk

| Storyboard frame | Shot list ID |
|---|---|
| 01 | SHOT-01 (mock alert wall — graphic) |
| 02–04 | SHOT-02 (stats card — graphic) |
| 05 | SHOT-03 (`/`) |
| 06 | SHOT-04 (`/batch`) |
| 07–09 | SHOT-05 (`/review/mr-patel`) |
| 10–12 | SHOT-05 (continued) |
| 13 | SHOT-06 (`/review/mrs-johnson`) |
| 14 | SHOT-04 (re-use) |
| 15 | SHOT-07 (CDS Hooks split — Postman + mock Epic) |
| 16–17 | SHOT-08, SHOT-09 (Prompt Opinion) |
| 18 | SHOT-10 (architecture graphic) |
| 19 | SHOT-05 (re-use freeze) |
| 20 | SHOT-11 (logo card) |
