# PolyPharmGuard Expansion Design

**Date:** 2026-04-08  
**Status:** Approved  
**Goal:** Add demo-impactful features that also lay production groundwork — web dashboard, clinical depth, infrastructure, and AI/intelligence layers.

---

## Architecture: Layered Hybrid (Approach C)

Keep the MCP server as the immovable core. Wrap with a Next.js app for everything visual and web-facing. Add a Python service only for ML risk scoring. Share the knowledge base and types across all layers.

```
Current Core (unchanged shape, grows in tool count)
├── MCP Server (TypeScript)     — 3 tools → 6 tools
├── A2A MedReview Agent         — gains batch_review capability
├── Knowledge Base (JSON)       — gains 3 new KBs
├── FHIR Client                 — unchanged
└── Gemini LLM                  — gains 4 new prompt templates

New Layer 1: Next.js App (/web)
├── Dashboard UI                — risk matrix, interaction graph, evidence chains
├── CDS Hooks endpoint          — /api/cds-hooks (HL7 CDS Hooks 2.0)
├── PDF report endpoint         — /api/reports/[reviewId]
├── Patient summary page        — plain-language findings
├── Feedback API                — /api/feedback (outcome loop)
└── Batch review UI             — multi-patient queue

New Layer 2: Python ML Service (/ml-service)
└── Risk scorer                 — POST /score → 90-day adverse event probability

New Layer 3: SQLite Database (/data/audit.db)
├── tool_calls table            — every MCP tool call logged
└── clinician_actions table     — accept/override/modify tracking
```

---

## Section 1: Web Dashboard

**Stack:** Next.js 15 App Router, Tailwind CSS, shadcn/ui, Cytoscape.js, React PDF.

### Routes

| Route | Purpose |
|-------|---------|
| `/` | Patient search + recent reviews |
| `/review/[patientId]` | Full medication review — main demo screen |
| `/batch` | Multi-patient queue for pharmacist rounds |
| `/patient-summary/[patientId]` | Plain-language report for the patient |
| `/reports/[reviewId]` | Server-rendered PDF for clinical documentation |

### Key UI Components on `/review/[patientId]`

1. **Risk Score Gauge** — prominent 0–100 score + "74% 90-day adverse event risk" at top
2. **Medication Risk Matrix** — drugs × risk factors (CYP3A4, QT, bleeding, renal, Beers), color-coded cells
3. **Drug Interaction Network Graph** — Cytoscape.js; nodes = drugs, edges = interactions, edge color = severity; click to expand evidence chain
4. **Evidence Chain Accordion** — each finding expandable with source badges (FDA Table, Beers 2023, FHIR Observation)
5. **Deprescribing Timeline** — Gantt-style taper schedule
6. **Action Bar** — Accept / Override / Modify per finding → feeds outcome feedback loop

---

## Section 2: Three New MCP Tools

### Tool 4: `analyze_pharmacodynamic_interactions`

Catches receptor-level interactions that CYP450 misses:
- **CNS depression accumulation**: opioids + benzos + gabapentin + antihistamines → respiratory depression risk score
- **QT prolongation stacking**: cumulative QTc risk vs. AHA thresholds
- **Bleeding risk accumulation**: NSAIDs + anticoagulants + SSRIs + antiplatelets → GI/intracranial bleed risk

New KB: `src/knowledge-base/pd-interactions.json`

### Tool 5: `check_pharmacogenomics`

Genotype-adjusted dosing:
- Input: CYP2D6 / CYP2C19 / CYP2C9 phenotype from FHIR Observation or manual input
- Poor metabolizer CYP2D6 + codeine = morphine toxicity at normal dose
- Rapid metabolizer CYP2C19 + clopidogrel = therapeutic failure

New KB: `src/knowledge-base/pharmacogenomics.json` — phenotype × drug → adjustment + consequence

### Tool 6: `check_lab_monitoring`

Flags missing or overdue safety monitoring:
- Digoxin → digoxin level (target 0.5–0.9 ng/mL in elderly)
- Warfarin → INR (check date + therapeutic range)
- Lithium → lithium level + TSH + renal
- Methotrexate → LFTs + CBC
- Checks FHIR Observation for most recent result + date

New KB: `src/knowledge-base/lab-monitoring.json` — drug → required lab + frequency + therapeutic range + action threshold

### New Gemini Prompts
- `src/mcp-server/prompts/pd-prompt.ts`
- `src/mcp-server/prompts/pharmacogenomics-prompt.ts`
- `src/mcp-server/prompts/lab-monitoring-prompt.ts`
- `src/mcp-server/prompts/patient-summary-prompt.ts` (6th-grade reading level enforced)

---

## Section 3: Infrastructure

### CDS Hooks (`/web/app/api/cds-hooks/`)

- Implements HL7 CDS Hooks 2.0
- Two hooks:
  - `medication-prescribe` — fires on new prescription, returns interaction warnings as CDS Cards
  - `patient-view` — fires on chart open, surfaces existing risks
- Response: CDS Cards with Summary, Detail, Source, and FHIR Suggestion (ready-to-apply MedicationRequest)
- Demo: show card appearing in mock EHR UI

### Multi-patient Batch Analysis

- New A2A agent task type: `batch_review`
- Input: array of patient IDs
- Configurable concurrency (default 5 parallel)
- Returns patients ranked by composite risk score
- UI: `/batch` page — pharmacist's prioritized morning rounds queue

### Audit Trail + PDF Reports

- SQLite at `/data/audit.db`
- `tool_calls`: timestamp, patient_id, tool_name, inputs_hash, outputs_json, latency_ms, clinician_id
- `clinician_actions`: review_id, finding_id, action (accept/override/modify), reason_text, clinician_id, timestamp
- PDF: server-side React PDF at `/api/reports/[reviewId]`
  - Patient demographics, all findings, evidence chains, recommendations, clinician signature block

---

## Section 4: AI/Intelligence

### Predictive Risk Scoring (`/ml-service`)

- **Language:** Python, scikit-learn
- **Features:** age, eGFR, hepatic score, number of meds, number of CYP interactions, presence of anticoagulant/opioid/antiarrhythmic, Beers count, PD risk flags
- **Output:** 0–100 risk score + 90-day adverse event probability
- **Endpoint:** `POST /ml-service/score`
- **Demo:** Mrs. Johnson = 74%. Replace simvastatin with pravastatin → 31%. Live proof of impact.
- **Training data:** synthetic (FAERS signals + Synthea) for hackathon; real outcomes in production

### Patient-Facing Summaries

- Gemini prompt: `patient-summary-prompt.ts` with Flesch-Kincaid 6th-grade constraint
- Three sections: "What we found", "Why it matters", "Questions to ask your doctor"
- Route: `/patient-summary/[patientId]` — printable, shareable
- Demo: split-screen clinical finding vs. patient translation

### Outcome Feedback Loop

- Dashboard action bar: Accept / Override / Modify per finding
- `POST /api/feedback` → stored in `clinician_actions` table
- Analytics view: override rate by drug class, acceptance rate by severity
- Production path: quarterly retraining of ML risk scorer from feedback data

---

## New File Structure

```
PolyPharmGuard/
├── web/                                 # NEW: Next.js 15 dashboard
│   ├── app/
│   │   ├── page.tsx                     # Patient search
│   │   ├── review/[patientId]/page.tsx  # Main review screen
│   │   ├── batch/page.tsx               # Multi-patient queue
│   │   ├── patient-summary/[patientId]/page.tsx
│   │   ├── reports/[reviewId]/page.tsx
│   │   └── api/
│   │       ├── cds-hooks/route.ts       # HL7 CDS Hooks 2.0
│   │       ├── reports/[reviewId]/route.ts
│   │       └── feedback/route.ts
│   ├── components/
│   │   ├── RiskScoreGauge.tsx
│   │   ├── MedicationRiskMatrix.tsx
│   │   ├── DrugInteractionGraph.tsx     # Cytoscape.js
│   │   ├── EvidenceChainAccordion.tsx
│   │   ├── DeprescribingTimeline.tsx
│   │   └── ActionBar.tsx
│   └── package.json
├── ml-service/                          # NEW: Python risk scorer
│   ├── main.py                          # FastAPI endpoint
│   ├── scorer.py                        # Logistic regression model
│   ├── features.py                      # Feature extraction
│   ├── train.py                         # Training script
│   └── requirements.txt
├── src/
│   ├── mcp-server/
│   │   ├── tools/
│   │   │   ├── pd-interactions.ts       # NEW: Tool 4
│   │   │   ├── pharmacogenomics.ts      # NEW: Tool 5
│   │   │   └── lab-monitoring.ts        # NEW: Tool 6
│   │   └── prompts/
│   │       ├── pd-prompt.ts             # NEW
│   │       ├── pharmacogenomics-prompt.ts # NEW
│   │       ├── lab-monitoring-prompt.ts # NEW
│   │       └── patient-summary-prompt.ts # NEW
│   ├── knowledge-base/
│   │   ├── pd-interactions.json         # NEW
│   │   ├── pharmacogenomics.json        # NEW
│   │   └── lab-monitoring.json          # NEW
│   └── a2a-agent/
│       └── batch-orchestrator.ts        # NEW: batch_review task type
└── data/
    └── audit.db                         # NEW: SQLite (gitignored)
```

---

## Demo Flow with Expansions

| Segment | Duration | What's New |
|---------|----------|------------|
| Hook | 20s | Same powerful stat |
| Dashboard landing | 15s | NEW: Risk score gauge — "74% risk. Here's why." |
| Interaction graph | 20s | NEW: Visual network of Mrs. Johnson's drug interactions |
| Cascade finding | 20s | Same clinical finding, now with visual evidence chain |
| PD finding | 15s | NEW: QT prolongation stacking — 3 drugs, additive risk |
| Lab monitoring | 10s | NEW: "No INR check in 6 weeks. Warfarin without monitoring." |
| Renal finding | 15s | Same, now shown in risk matrix cell |
| Deprescribing | 15s | Same taper plan, now shown as Gantt timeline |
| Patient summary | 10s | NEW: Split screen — clinical vs. plain language |
| CDS Hooks card | 10s | NEW: "This is how it looks inside your EHR" |
| Risk score drop | 10s | NEW: Accept recommendations → score drops 74%→31% |
| Architecture | 15s | Updated slide showing all layers |
| Impact | 10s | Same closing |

Total: ~3 min 15s — trim as needed.
