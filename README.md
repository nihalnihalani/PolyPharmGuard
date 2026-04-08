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

### Three MCP Tools

| Tool | What It Does | Example |
|------|-------------|---------|
| `analyze_cascade_interactions` | Multi-drug CYP450 pharmacokinetic cascade reasoning | "Fluconazole inhibits CYP3A4 -> increases simvastatin levels 20x -> with eGFR 28, rhabdomyolysis risk critically elevated" |
| `check_organ_function_dosing` | Cross-references dosing against patient's real-time eGFR and hepatic function from FHIR | "Metformin 1000mg BID with eGFR 28 - contraindicated below 30 per FDA labeling" |
| `screen_deprescribing` | Identifies candidates for medication discontinuation using Beers Criteria 2023 and STOPPFrail | "Omeprazole 40mg x 18 months, no documented GERD - AGA recommends PPI trial discontinuation" |

### A2A MedReview Agent

A thin orchestration agent that composes the three MCP tools into a complete medication review workflow, demonstrating the "Agents Assemble" paradigm.

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
    +---------+-------------------------------------+---------+------+
              |                                     |         |
    +---------v--------+               +------------v---+  +--v-----------+
    | FHIR MCP Server  |               | openFDA FAERS  |  | Med Terms    |
    | (Patient data,   |               | (Severity      |  | MCP (ICD-11, |
    |  labs, meds)     |               |  enrichment)   |  |  SNOMED,     |
    +------------------+               +----------------+  |  LOINC,      |
                                                           |  RxNorm)     |
                                                           +--------------+
```

---

## Tech Stack

| Component | Tool | Cost |
|-----------|------|------|
| MCP Server | TypeScript SDK (po-community-mcp reference) | Free |
| A2A Agent | Google ADK (po-adk-typescript reference) | Free |
| LLM | Gemini via Google AI Studio | Free |
| FHIR Data | AgentCare or Momentum FHIR MCP + HAPI FHIR | Free |
| Drug Data | Local CYP450 KB (FDA tables) + openFDA FAERS | Free |
| Terminology | Medical Terminologies MCP (27 tools) | Free |
| Patient Data | Synthea synthetic patients | Free |
| Guardrails | NeMo Guardrails / Guardrails AI | Free |
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
