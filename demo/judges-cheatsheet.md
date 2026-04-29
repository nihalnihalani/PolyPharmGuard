# Judges' Cheat Sheet — PolyPharmGuard

Print this. Bring it to the live Q&A. Pin it inside the Devpost submission.

The Agents Assemble healthcare track judges three things: **AI Factor**, **Impact**, **Feasibility**. Each maps to a specific moment in the demo.

---

## The 3-criterion → demo-moment table

| Criterion | Demo timestamp | Frame # | What it proves |
|-----------|---------------|---------|----------------|
| **AI Factor** — does the agent reason in a way a rules-engine cannot? | **0:30–1:20** (Mr. Patel pairwise-vs-synthesis) | 06–09 | Four-drug synergistic CYP1A2 + CYP3A4 + CYP2C19 cascade with cited steps. No pairwise checker surfaces this. The reasoning emerges from composing the CYP450 KB, FAERS enrichment, eGFR context, and the LLM's chain-of-thought over verified facts — *not* from a static lookup table. The "Pairwise: 0 critical alerts. PolyPharmGuard: 4 cited findings" overlay is the literal apples-to-apples proof. |
| **Impact** — does this address a real, measurable healthcare problem? | **0:08–0:20** (stat slam) + **1:35–1:50** (Mrs. Johnson) | 02–04, 13 | 95% override / 1.3M ER visits / $30B preventable cost. Mrs. Johnson is the textbook polypharmacy patient — 78yo, 12 meds, eGFR 28 — and we ship a 4-week deprescribing taper, a renal-adjusted dosing recommendation, and a cited interaction. We don't just identify; we prescribe action. |
| **Feasibility** — could this actually deploy into a hospital tomorrow? | **2:00–2:25** (CDS Hooks + Marketplace) | 15–17 | HL7 CDS Hooks 2.0 — the actual standard every modern EHR (Epic, Cerner) consumes. Plus FHIR R4 patient ingestion via SHARP context (no new auth flows). Plus Prompt Opinion Marketplace distribution (discoverable, billable, governed). No new integration burden on the hospital. |

---

## The closing line (memorize it)

> **"Twenty-three alerts is alert fatigue. Three cited findings is medicine."**

Backup variant if you flub it: *"The EHR fired 23 alerts. We found the 3 that matter — and we cited every step."*

---

## "Is this just a rules engine wearing an LLM costume?" — The 1-paragraph rebuttal

If a skeptical judge asks this — and one will — answer with the following, paraphrased:

> No. A rules engine matches static drug-pair conditions and emits a fixed alert. PolyPharmGuard composes evidence dynamically: it reads the active medication list, queries the CYP450 substrate/inhibitor/inducer KB, cross-checks pharmacodynamic class overlap, fetches the patient's eGFR and LFTs from FHIR, weights findings against age and conditions from Beers/STOPPFrail, and uses Gemini to synthesize a clinical narrative — but the LLM is constrained to reason *only* over those verified facts, with every step required to cite a source. The Mr. Patel cascade — fluvoxamine + tizanidine + Paxlovid + clopidogrel — has never appeared as a hardcoded rule in any commercial DDI checker we've reviewed. The agent constructed it. That's the AI Factor.

---

## Quick numbers to have at hand

- **6 MCP tools**: cascade-interactions, organ-function-dosing, deprescribing-screen, pd-interactions, lab-monitoring, pharmacogenomics
- **70 tests passing** (per project memory)
- **CYP450 KB**: top 200 drugs from FDA Drug Development and Drug Interactions tables
- **Beers Criteria 2023**, **STOPPFrail**, encoded
- **Time to review one patient end-to-end**: ~3–5 seconds (Gemini latency)
- **Citation coverage**: every finding has ≥1 source tag visible in evidence chain

## What to NOT claim

- We do not have FDA clearance. This is decision support, not autonomous prescribing.
- We are not connected to a live Epic instance — CDS Hooks is the spec we conform to, with curl-verified responses, and a mock Epic order screen.
- Mr. Patel and Mrs. Johnson are Synthea synthetic patients. Zero PHI involved.
- The 95% / 1.3M / $30B figures are sourced literature estimates (Bates 2003 JAMIA, CDC, ASHP) — not our numbers.

## If asked "what's next?"

1. Live FHIR pilot with a teaching hospital — already have IRB conversations
2. Pharmacogenomics tool deepening: PharmGKB integration for CPIC guidelines
3. Multi-language patient summaries (Spanish, Mandarin)
4. Real-world validation: prospective study comparing override rate of our cited findings vs. legacy DDI checker alerts

---

## The 30-second elevator answer (if hosts cut you to 30 sec)

> The EHR fires 23 alerts; clinicians override 95% of them and people die. PolyPharmGuard is six MCP tools and an A2A agent that build evidence-cited medication reviews from real FHIR data — including multi-drug CYP450 cascades that no pairwise checker catches. We ship as standard CDS Hooks, distribute through Prompt Opinion, and every finding cites its source. Reasoning, not warnings.
