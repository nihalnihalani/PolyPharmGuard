# PolyPharmGuard — Demo Video Script

**Target runtime:** 2:30 (hard ceiling 3:00)
**Pace:** 140 words per minute
**Total VO words:** ~360
**Read aloud test:** record yourself once, confirm 2:20–2:40 with stopwatch

Format: `[mm:ss–mm:ss]` `[VOICEOVER]` / `[ON-SCREEN]` / `[CURSOR]`

---

## ACT 1 — THE HOOK (0:00–0:30)

### Beat 1.1 — Cold open (0:00–0:08)

`[ON-SCREEN]` Full-screen mock Epic alert wall: 23 grey dismissed-looking interaction alerts stacked vertically, each with an "Override" checkbox already checked. Subtle red flash on the "23 alerts" counter at the top.

`[VOICEOVER]` Twenty-three alerts. The doctor ignored every single one. Three of them could have killed her.

`[CURSOR]` None — static title card.

### Beat 1.2 — Stat slam (0:08–0:20)

`[ON-SCREEN]` Three stats fade in one at a time over a dark background, big white type:
- "95% — alert override rate in U.S. hospitals"
- "1.3 million — annual ER visits from adverse drug events"
- "$30 billion — preventable cost, every year"

`[VOICEOVER]` Ninety-five percent of EHR drug alerts are overridden. The result: one-point-three million emergency visits a year, thirty billion dollars in preventable harm. The problem isn't too few alerts. It's that none of them are about *this* patient.

`[CURSOR]` None.

### Beat 1.3 — Product reveal (0:20–0:30)

`[ON-SCREEN]` Hard cut to PolyPharmGuard landing page (`/`). Logo, tagline, red "Run Medication Review" button visible.

`[VOICEOVER]` PolyPharmGuard replaces the alert wall with cited clinical reasoning. Three MCP tools, one A2A agent, real FHIR data.

`[CURSOR]` Mouse drifts over the "Run Medication Review" button but does not click yet — held for the next beat.

---

## ACT 2 — THE AI REASONING (0:30–1:50)

### Beat 2.1 — Mr. Patel: the subtle case (0:30–0:55)

`[ON-SCREEN]` Click "Review Queue" in the nav. Land on `/batch`. Two patient rows visible — Mr. Patel at top with risk score 80 CRITICAL, Mrs. Johnson below. Hover then click his row.

`[VOICEOVER]` Meet Mr. Patel. Sixty-two, on fluvoxamine, tizanidine, and clopidogrel — and he just finished a Paxlovid course. Every pairwise checker his pharmacy uses passed him. Ours didn't.

`[CURSOR]` Click "Review" next to Mr. Patel. Page transitions to `/review/mr-patel`.

`[ON-SCREEN]` Risk gauge spins up to 80 / CRITICAL in red. A side-by-side panel slides in: left "Pairwise Checker — 0 critical alerts." Right: "PolyPharmGuard — 4 cited cascade findings."

### Beat 2.2 — The synthesis moment (0:55–1:20)

`[ON-SCREEN]` Cursor expands the top finding in the Evidence Chain accordion. Four numbered steps appear, each with an `[FDA Table 3-1]` or `[DDI Predictor]` citation.

`[VOICEOVER]` Fluvoxamine is a strong CYP1A2 inhibitor. Tizanidine is metabolized by CYP1A2. The AUC goes up tenfold. That alone is dangerous. Add residual ritonavir from Paxlovid blocking CYP3A4, plus clopidogrel — a CYP2C19 prodrug now competing for what's left — and you have a synergistic hypotension and bleeding risk that no two-drug rule could see.

`[CURSOR]` Cursor moves down the four citation lines as VO names each drug. Linger on `[FDA Drug Development and Drug Interactions Table — CYP1A2]`.

### Beat 2.3 — The hero surfaces (1:20–1:35)

`[ON-SCREEN]` Scroll smoothly down the review page. Show, in order:
- Composite risk gauge with named factors: "Active CYP cascade finding (HIGH) x2", "Prodrug activation failure x1", "Residual CYP3A4 inhibitor window", "DAPT at risk"
- Cytoscape drug interaction graph with colored edges from fluvoxamine to clopidogrel, tizanidine, and atorvastatin
- Medication risk matrix table (rows of meds × cascade / PD / renal / Beers / lab columns)

`[VOICEOVER]` Composite risk index. Drug interaction graph. Medication-by-risk-factor matrix. Every red cell links back to a citation.

`[CURSOR]` Hover one red cell in the matrix — tooltip surfaces showing the FDA citation.

### Beat 2.4 — Mrs. Johnson: and the obvious stuff too (1:35–1:50)

`[ON-SCREEN]` Click nav link "Demo Review" — land on `/review/mrs-johnson`. Risk gauge: 74 CRITICAL. Scroll to the deprescribing finding.

`[VOICEOVER]` And Mrs. Johnson, seventy-eight, twelve meds, eGFR twenty-eight. We catch the obvious things too — fluconazole inhibiting CYP3A4 to spike her simvastatin three-fold, with renal impairment amplifying rhabdomyolysis risk. Plus a four-week taper plan for the PPI she's been on for a decade.

`[CURSOR]` Expand the simvastatin cascade finding, then the deprescribing finding showing the taper schedule template.

---

## ACT 3 — DISTRIBUTION + CLOSE (1:50–3:00)

### Beat 3.1 — Pharmacist queue (1:50–2:00)

`[ON-SCREEN]` Click nav "Review Queue" — back to `/batch`. Two patients ranked by composite risk index: Mr. Patel 80 / CRITICAL on top, Mrs. Johnson around 74 / CRITICAL below.

`[VOICEOVER]` Pharmacists triage by risk, not by alphabet. Highest-risk patient first.

`[CURSOR]` Hover Mr. Patel's risk badge to highlight the ranking.

### Beat 3.2 — CDS Hooks integration (2:00–2:15)

`[ON-SCREEN]` Split view. Left: a mock Epic order-entry screen with "Add medication: tizanidine" and a CDS Hooks card popping up — red "critical" indicator, summary text, "View full review" button. Right: the `POST /api/cds-hooks` JSON response in a code panel showing the matching `cards[]` payload.

`[VOICEOVER]` Inside the EHR, we ship as standard HL7 CDS Hooks. No custom integration. Every order screen gets cited findings — not generic alerts.

`[CURSOR]` Cursor traces the JSON path `cards[0].source.label`.

### Beat 3.3 — Marketplace cutaway (2:15–2:25)

`[ON-SCREEN]` Three-second cutaway: Prompt Opinion Marketplace listing page. PolyPharmGuard tile visible with clinical-safety badge. Quick zoom into the agent invocation panel showing a tool call to `analyze_cascade_interactions` and the JSON response.

`[VOICEOVER]` PolyPharmGuard is discoverable, invocable, and billable inside Prompt Opinion. SHARP context flows in. Findings flow back.

`[CURSOR]` Brief click on the agent tile, then on a sample tool call result.

### Beat 3.4 — Architecture flash card (2:25–2:35)

`[ON-SCREEN]` Single dark slide. Four boxes connected by arrows: `MCP Server (6 tools)` → `A2A MedReview Agent` → `SHARP context` → `FHIR + Gemini`. Labels small but legible.

`[VOICEOVER]` Six MCP tools. One A2A orchestrator. SHARP-secured FHIR. Gemini reasoning grounded only on verified knowledge bases — every finding cites its source.

`[CURSOR]` None.

### Beat 3.5 — Closing (2:35–2:50)

`[ON-SCREEN]` Cut back to Mr. Patel review page, freeze on the four-step evidence chain. Closing line types in below the gauge.

`[VOICEOVER]` Twenty-three alerts is alert fatigue. Three cited findings is medicine. PolyPharmGuard. Reasoning, not warnings.

`[ON-SCREEN]` Final logo card with team name, GitHub URL, and Devpost URL. Hold 4 seconds.

`[CURSOR]` None.

### Buffer (2:50–3:00)

10 seconds of safety margin. If pacing creeps over, cut Beat 3.4 architecture card to 5 seconds — the tools speak for themselves.

---

## Hard cuts if running long

In priority order, drop these to claw back time:
1. Beat 1.2 stat slam — drop two of three stats (saves 4 sec)
2. Beat 2.3 — show only matrix or only graph, not both (saves 5 sec)
3. Beat 3.4 architecture card — replace with one-line on-screen text overlay during 3.5 (saves 8 sec)

## Hard adds if running short

1. Extend Beat 2.2 with one more citation expansion (good — more proof)
2. In Beat 2.4, click "Patient Summary" link to flash the plain-English version (5 sec)

---

## Word count check

Voice-over text only (no stage directions):

> Twenty-three alerts. The doctor ignored every single one. Three of them could have killed her. Ninety-five percent of EHR drug alerts are overridden. The result: one-point-three million emergency visits a year, thirty billion dollars in preventable harm. The problem isn't too few alerts. It's that none of them are about this patient. PolyPharmGuard replaces the alert wall with cited clinical reasoning. Three MCP tools, one A2A agent, real FHIR data. Meet Mr. Patel. Sixty-two, on fluvoxamine, tizanidine, and clopidogrel — and he just finished a Paxlovid course. Every pairwise checker his pharmacy uses passed him. Ours didn't. Fluvoxamine is a strong CYP1A2 inhibitor. Tizanidine is metabolized by CYP1A2. The AUC goes up tenfold. That alone is dangerous. Add residual ritonavir from Paxlovid blocking CYP3A4, plus clopidogrel — a CYP2C19 prodrug whose bioactivation fluvoxamine also inhibits — and you have a synergistic hypotension and bleeding risk that no two-drug rule could see. Composite risk index. Drug interaction graph. Medication-by-risk-factor matrix. Every red cell links back to a citation. And Mrs. Johnson, seventy-eight, twelve meds, eGFR twenty-eight. We catch the obvious things too — fluconazole inhibiting CYP3A4 to spike her simvastatin three-fold, with renal impairment amplifying rhabdomyolysis risk. Plus a four-week taper plan for the PPI she's been on for a decade. Pharmacists triage by risk, not by alphabet. Highest-risk patient first. Inside the EHR, we ship as standard HL7 CDS Hooks. No custom integration. Every order screen gets cited findings — not generic alerts. PolyPharmGuard is discoverable, invocable, and billable inside Prompt Opinion. SHARP context flows in. Findings flow back. Six MCP tools. One A2A orchestrator. SHARP-secured FHIR. Gemini reasoning grounded only on verified knowledge bases — every finding cites its source. Twenty-three alerts is alert fatigue. Three cited findings is medicine. PolyPharmGuard. Reasoning, not warnings.

**Spoken word count: ~296 words → ~2:07 of pure speech at 140 wpm. With ~15s of pauses/beats from narration.md, realistic delivery: 2:20–2:30. Safely within target.**
