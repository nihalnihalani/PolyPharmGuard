# PolyPharmGuard

> *"The EHR fired 23 alerts. The doctor ignored all of them. We found three that could save her life."*

A clinical polypharmacy reasoning engine built for the **Agents Assemble: The Healthcare AI Endgame** hackathon. PolyPharmGuard replaces the broken "alert everything" paradigm with contextual, patient-specific medication safety analysis using MCP, A2A, and FHIR.

---

## Hackathon Details

| Detail | Info |
|--------|------|
| **Hackathon** | [Agents Assemble - The Healthcare AI Endgame](https://agents-assemble.devpost.com/) |
| **Sponsor** | Prompt Opinion (Darena Health) |
| **Platform** | [Prompt Opinion](https://www.promptopinion.ai/) / [Devpost](https://agents-assemble.devpost.com/) |
| **Prize Pool** | $25,000 USD ($7,500 Grand Prize) |
| **Participants** | 2,372+ |
| **Submission Period** | March 4, 2026 - May 11, 2026 |
| **Winners Announced** | ~May 27, 2026 |

### Judging Criteria (Equal Weight)

1. **The AI Factor** - Does the solution leverage Generative AI to address a challenge that traditional rule-based software cannot?
2. **Potential Impact** - Does this address a significant pain point? Is there a clear hypothesis for how this improves outcomes, reduces costs, or saves time?
3. **Feasibility** - Could this exist in a real healthcare system today? Does architecture respect data privacy, safety standards, and regulatory constraints?

### Judges

- **Josh Mandel, MD** - Chief Architect for Health, Microsoft Research
- **Joshua Hickey** - Principal Technical Product Manager, Mayo Clinic
- **Parth Tripathi** - Staff Engineer, Vertex AI Gemini Serving, Google
- **Piyush Mathur, MD** - Staff Anesthesiologist/Intensivist, Cleveland Clinic
- **Stephon Proctor, PhD** - ACHIO for Platform Innovation, CHOP
- **Alice Zheng, MD, MBA, MPH** - Venture Capitalist, ex-McKinsey

---

## The Problem

Alert fatigue is destroying medication safety:

- **95%** of drug interaction alerts in EHRs are overridden by clinicians
- **1.3 million** Americans visit the ER annually from adverse drug reactions
- **40%** of adults over 65 are on 5+ medications (polypharmacy)
- **$30 billion** annual cost of adverse drug events in the US
- Current EHR alerts use **pairwise lookups** that miss multi-drug cascades and ignore patient-specific context (organ function, age, weight)

The alerts are not wrong - they are *clinically useless noise*. Clinicians have learned to ignore them, and genuinely dangerous interactions slip through.

---

## The Solution

PolyPharmGuard is an MCP server + A2A agent that provides **contextual medication safety analysis**:

### Six MCP Tools

| Tool | What It Does | Example |
|------|-------------|---------|
| `analyze_cascade_interactions` | Multi-drug CYP450 pharmacokinetic cascade reasoning | "Fluconazole inhibits CYP3A4 -> increases simvastatin levels 20x -> with eGFR 28, rhabdomyolysis risk critically elevated" |
| `check_organ_function_dosing` | Cross-references dosing against patient's real-time eGFR and hepatic function from FHIR | "Metformin 1000mg BID with eGFR 28 - contraindicated below 30 per FDA labeling" |
| `screen_deprescribing` | Identifies candidates for medication discontinuation using Beers Criteria 2023 and STOPPFrail | "Omeprazole 40mg x 18 months, no documented GERD - AGA recommends PPI trial discontinuation" |
| `analyze_pharmacodynamic_interactions` | Detects non-CYP interactions: CNS depression, QT prolongation, bleeding, hyperkalemia | "Trazodone + oxycodone + diphenhydramine: triple CNS depression in a 78yo - fall and respiratory depression risk" |
| `check_pharmacogenomics` | CPIC-cited genotype-adjusted dosing recommendations (CYP2D6, CYP2C19, CYP2C9) | "CYP2C19 poor metabolizer on clopidogrel - CPIC recommends prasugrel/ticagrelor (reduced active metabolite)" |
| `check_lab_monitoring` | Flags missing, overdue, or out-of-range monitoring labs for high-risk meds | "Warfarin 5mg daily, last INR 47 days ago - overdue per ACC/AHA monitoring guidance" |

### A2A MedReview Agent

A thin orchestration agent that composes the six MCP tools into a complete medication review workflow, demonstrating the "Agents Assemble" paradigm.

---

## Hero Examples

### Mrs. Johnson — 78yo, 12 medications, eGFR 28

The classic toxicity cascade. New fluconazole prescription for thrush stacks on top of long-term simvastatin and an eGFR of 28 mL/min:

- Fluconazole inhibits CYP3A4 -> simvastatin AUC rises ~20x
- Renal clearance is already half-normal (eGFR 28)
- Combined: rhabdomyolysis risk goes from "watch" to "critical"

Pairwise EHR alerts fire for fluconazole+simvastatin and for metformin+eGFR independently and get overridden as noise. PolyPharmGuard composes them into a single context-aware cascade with a CRITICAL severity tied to the patient's actual labs.

### Mr. Patel — 62yo, post-DES on DAPT, recent COVID

The *loss-of-efficacy* cascade that pairwise checkers miss entirely:

- Drug-eluting stent placed 4 months ago; dual antiplatelet therapy (aspirin + clopidogrel) is mandatory through month 12
- Psychiatry adds **fluvoxamine** for OCD - a strong **CYP2C19 inhibitor**
- Clopidogrel is a **prodrug**: it requires CYP2C19 to form the active metabolite that blocks platelets
- Fluvoxamine therefore *reduces* clopidogrel activation -> **stent thrombosis risk**, not bleeding risk
- Recent **Paxlovid** course (ritonavir, strong CYP3A4 inhibitor) compounds with **atorvastatin** - residual inhibitor window after discontinuation still elevates statin exposure

A pairwise interaction database typically flags fluvoxamine+clopidogrel as "monitor" or misses it because the combination "doesn't increase clopidogrel levels." The AI gets the *direction* right (loss of efficacy) and the *clinical context* right (post-DES + DAPT compromise = CRITICAL, not "monitor").

---

## AI Factor Headline

Pairwise rule engines have shipped in EHRs for 30 years. Here is what they cannot do, and what GenAI grounded on a verified knowledge base *can*:

- **Multi-enzyme reasoning across 3+ drugs simultaneously** — A is a CYP3A4 inhibitor, B is a substrate, C induces a parallel pathway, D is renally cleared and the patient's eGFR is 28. Rule engines flag pairs; the LLM composes the network.
- **Prodrug activation semantics** — Clopidogrel, codeine, and tamoxifen require CYP-mediated activation. An inhibitor *reduces* their effect, the opposite direction of the usual "inhibitor -> toxicity" pattern. Pairwise databases routinely get the direction wrong or omit the interaction.
- **Temporal reasoning** — Strong inhibitors (ritonavir, amiodarone) persist for days to weeks after discontinuation. The LLM reasons about residual-inhibitor windows; rule engines treat "not currently prescribed" as "not present."
- **Context-aware severity escalation** — Fluvoxamine + clopidogrel in a healthy adult is a *monitor*. The same pair in a post-DES patient on mandatory DAPT is *critical*. Severity is a function of the patient context (age, eGFR, indications, recent procedures), not the drug pair alone.

Every finding cites its source — FDA CYP table, Beers Criteria 2023, STOPPFrail, CPIC guideline, or a FHIR observation — so clinicians can audit the chain end-to-end. The LLM reasons over verified data; it never invents drug interactions.

---

## Architecture

```
                    +-------------------------------+
                    |   Prompt Opinion Platform     |
                    |   (SHARP Context + COIN)      |
                    +---------------+---------------+
                                    | A2A
                    +---------------v---------------+
                    |   MedReview Agent (A2A)       |
                    |   Orchestrates medication     |
                    |   review workflow             |
                    +---------------+---------------+
                                    | MCP
              +---------------------+---------------------+
              |                     |                     |
    +---------v--------+  +--------v---------+  +--------v-----------+
    | Cascade          |  | Organ-Function   |  | Deprescribing      |
    | Interaction      |  | Dose Check       |  | Screen             |
    | Analysis         |  |                  |  |                    |
    +--------+---------+  +--------+---------+  +--------+-----------+
              |                     |                     |
    +---------v---------------------v---------------------v----------+
    |              Local CYP450 Knowledge Base                       |
    |  (FDA Tables + Beers Criteria + STOPPFrail + Renal Dosing)    |
    +---------+------------------------------------------------------+
              |
    +---------v--------+
    | FHIR MCP Server  |
    | (Patient data,   |
    |  labs, meds)     |
    +------------------+

    Future work (NOT implemented in this hackathon submission):
    - openFDA FAERS adverse-event severity enrichment
    - Medical Terminologies MCP (ICD-11, SNOMED, LOINC, RxNorm) lookup
```

---

## Tech Stack

| Component | Tool | Cost |
|-----------|------|------|
| MCP Server | TypeScript SDK (po-community-mcp reference) | Free |
| A2A Agent | Google ADK (po-adk-typescript reference) | Free |
| LLM | Gemini via Google AI Studio | Free |
| FHIR Data | AgentCare or Momentum FHIR MCP + HAPI FHIR | Free |
| Drug Data | Local CYP450 KB (FDA tables) | Free |
| Terminology | RxNorm CUIs hard-coded in local KB *(Medical Terminologies MCP integration: future work)* | Free |
| Adverse-event enrichment | *Future work — openFDA FAERS not implemented in this submission* | Free |
| Patient Data | Synthea synthetic patients | Free |
| Guardrails | Custom clinical output validator (`src/llm/guardrails.ts`) | Free |
| Platform | Prompt Opinion Marketplace | Free |

**Total cost: $0**

---

## 5Ts Output Coverage

| Output Type | Example |
|-------------|---------|
| **Talk** | "Warning: metformin is contraindicated with current eGFR of 28" |
| **Template** | Deprescribing plan with 4-week taper schedule |
| **Table** | Medication risk matrix (drug x risk-factor grid) |
| **Transaction** | FHIR MedicationRequest updates for dose adjustments |
| **Task** | Pharmacy review tasks for flagged interactions |

---

## Key Standards

- **MCP** (Model Context Protocol) - Tool exposure and discovery
- **A2A** (Agent-to-Agent Protocol) - Multi-agent orchestration
- **FHIR R4** - Healthcare data interoperability
- **SHARP** (Standardized Healthcare Agent Remote Protocol) - FHIR context propagation via `X-FHIR-Server-URL`, `X-FHIR-Access-Token`, `X-Patient-ID` headers
- **COIN** (Conversational Interoperability) - Platform-native agent communication

---

## Build Timeline

| Week | Focus | Deliverable |
|------|-------|-------------|
| Week 1 (Apr 8-14) | CYP450 knowledge base + SHARP integration + MCP scaffold | Working data layer + SHARP-compliant server |
| Week 2 (Apr 15-21) | Three MCP tools (cascade, renal dose, deprescribing) | Core tools functional with test cases |
| Week 3 (Apr 22-28) | A2A MedReview Agent + Marketplace publishing | End-to-end on Prompt Opinion |
| Week 4 (Apr 29-May 5) | Polish, edge cases, guardrails, demo video | Production-quality demo |
| Buffer (May 6-11) | Final testing, video upload, submission | Submitted |

---

## Project Structure

```
PolyPharmGuard/
├── README.md
├── docs/
│   ├── polypharmguard-design.md      # Primary project design
│   ├── dischargeguard-design.md      # Backup project design
│   └── plans/                        # Implementation plans
├── src/
│   ├── mcp-server/                   # MCP server (TypeScript)
│   ├── a2a-agent/                    # A2A MedReview Agent
│   └── knowledge-base/              # CYP450, Beers, STOPPFrail data
├── data/
│   └── synthea/                      # Synthetic patient data
└── demo/                             # Demo video assets
```

---

## Resources

- [Prompt Opinion Platform](https://www.promptopinion.ai/)
- [Prompt Opinion Docs](https://docs.promptopinion.ai)
- [SHARP on MCP Specification](https://sharponmcp.com/)
- [po-community-mcp (Reference MCP Server)](https://github.com/prompt-opinion/po-community-mcp)
- [po-adk-typescript (Reference A2A Agent)](https://github.com/prompt-opinion/po-adk-typescript)
- [Hackathon Getting Started Video](https://youtu.be/Qvs_QK4meHc)
- [MCP Specification](https://modelcontextprotocol.io/specification/2025-11-25)
- [A2A Protocol](https://a2a-protocol.org/latest/specification/)
- [FHIR R4 Specification](https://www.hl7.org/fhir/)

---

## License

MIT
