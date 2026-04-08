# PolyPharmGuard - Project Design Document

**Project:** PolyPharmGuard - Clinical Polypharmacy Reasoning Engine
**Hackathon:** Agents Assemble - The Healthcare AI Endgame
**Track:** Both (MCP Server "Superpower" + A2A Agent)
**Date:** April 8, 2026

---

## Executive Summary

PolyPharmGuard is a clinical polypharmacy reasoning engine that replaces the broken "alert everything" paradigm with contextual, patient-specific medication safety analysis. It exposes three MCP tools for cascade interaction analysis, organ-function dose checking, and deprescribing screening, orchestrated by a thin A2A MedReview Agent.

**Tagline:** *"The EHR fired 23 alerts. The doctor ignored all of them. We found three that could save her life."*

---

## 1. Problem Statement

### The Alert Fatigue Crisis

Current EHR drug interaction systems are fundamentally broken:

- **95% override rate**: Clinicians override the vast majority of drug interaction alerts because they are clinically irrelevant noise
- **Pairwise-only checking**: Existing systems check Drug A vs Drug B, but miss multi-drug pharmacokinetic cascades (Drug A affects enzyme metabolism of Drug B, changing levels relevant to Drug C)
- **Context-blind**: Alerts fire identically for a 25-year-old with normal kidneys and a 78-year-old with CKD Stage 4 — the clinical significance is completely different
- **No deprescribing support**: Systems alert on what to worry about but never suggest what to stop

### Impact by the Numbers

- 1.3 million ED visits annually from adverse drug reactions in the US
- $30 billion annual cost of adverse drug events
- 40% of adults over 65 on 5+ medications (polypharmacy)
- 7,000-9,000 deaths per year from medication errors
- Each additional medication increases adverse drug reaction risk by 8.6%
- 27% of malpractice claims involve medication errors
- FDA reduced oversight of low-risk CDS tools (January 2026) — clear regulatory pathway

---

## 2. Solution Design

### 2.1 Three MCP Tools

#### Tool 1: `analyze_cascade_interactions`

**Purpose:** Detect multi-drug pharmacokinetic cascade interactions that pairwise checkers miss.

**How it works:**
1. Receives patient's complete medication list from FHIR (MedicationRequest resources)
2. Queries local CYP450 Knowledge Base for enzyme substrate/inhibitor/inducer relationships
3. Uses LLM (Gemini) to reason about cascade chains:
   - Identify all CYP enzyme pathways involved
   - Detect inhibition/induction chains across 2+ drugs
   - Assess downstream clinical consequences (QT prolongation, bleeding risk, toxicity)
4. Enriches findings with openFDA FAERS real-world adverse event frequency
5. Returns ranked findings with full evidence chains and citations

**Example output:**
```json
{
  "finding": "CASCADE: CYP3A4-mediated interaction",
  "severity": "CRITICAL",
  "chain": [
    {"step": 1, "fact": "Fluconazole is a strong CYP3A4 inhibitor", "source": "FDA CYP3A4 Table"},
    {"step": 2, "fact": "Simvastatin is a CYP3A4 substrate", "source": "FDA CYP3A4 Table"},
    {"step": 3, "fact": "CYP3A4 inhibition increases simvastatin exposure up to 20x", "source": "Simvastatin FDA Label"},
    {"step": 4, "fact": "Patient eGFR = 28 mL/min (CKD Stage 4) further impairs clearance", "source": "FHIR Observation LOINC:33914-3"}
  ],
  "clinical_consequence": "Critically elevated rhabdomyolysis risk",
  "recommendation": "Switch to pravastatin (not CYP3A4 dependent) or rosuvastatin (minimal CYP3A4 metabolism)",
  "faers_signal": "2,847 FAERS reports of rhabdomyolysis with statin + azole antifungal combinations"
}
```

#### Tool 2: `check_organ_function_dosing`

**Purpose:** Cross-reference each medication's dosing against the patient's current renal and hepatic function.

**How it works:**
1. Pulls patient's current eGFR from FHIR Observation (LOINC: 33914-3) and liver function tests (ALT, AST, bilirubin)
2. Queries local renal/hepatic dose adjustment database for each active medication
3. Flags medications requiring dose adjustment or discontinuation at the patient's current organ function level
4. Generates specific dose adjustment recommendations with FDA labeling citations

**Example output:**
```json
{
  "finding": "RENAL DOSE ALERT",
  "severity": "HIGH",
  "medication": "Metformin 1000mg BID",
  "patient_egfr": 28,
  "egfr_source": "FHIR Observation from 2026-04-05",
  "threshold": "Contraindicated below eGFR 30 mL/min per FDA labeling",
  "recommendation": "Discontinue metformin or reduce to 500mg daily with weekly renal monitoring",
  "alternative": "Consider DPP-4 inhibitor (linagliptin - no renal adjustment needed)"
}
```

#### Tool 3: `screen_deprescribing`

**Purpose:** Identify medications that should be considered for discontinuation based on evidence-based deprescribing criteria.

**How it works:**
1. Pulls patient demographics (age), conditions, and medication list from FHIR
2. Screens against encoded Beers Criteria 2023 (AGS) for potentially inappropriate medications in older adults
3. Screens against STOPPFrail criteria for patients with limited life expectancy
4. Checks medication duration against guidelines (e.g., PPIs > 8 weeks without documented indication)
5. Generates prioritized deprescribing recommendations with tapering schedules

**Example output:**
```json
{
  "finding": "DEPRESCRIBING CANDIDATE",
  "severity": "MODERATE",
  "medication": "Omeprazole 40mg daily",
  "duration": "18 months",
  "indication_status": "No documented GERD, Barrett's, or H. pylori in FHIR Condition resources",
  "guideline": "AGA 2023: Recommend PPI trial discontinuation after 8 weeks if no clear indication",
  "beers_flag": "Beers 2023: Avoid PPI use > 8 weeks in older adults without high-risk indication",
  "taper_plan": [
    {"week": 1, "dose": "Omeprazole 20mg daily"},
    {"week": 2, "dose": "Omeprazole 20mg every other day"},
    {"week": 3, "dose": "Omeprazole 20mg every 3rd day"},
    {"week": 4, "dose": "Discontinue. Start famotidine 20mg as needed for rebound symptoms."}
  ]
}
```

### 2.2 A2A MedReview Agent

A thin orchestration agent built with Google ADK that:

1. Receives a medication review request via A2A protocol
2. Extracts FHIR context from SHARP headers (patient ID, FHIR server URL, access token)
3. Invokes all three MCP tools in sequence:
   - `analyze_cascade_interactions` -> cascade findings
   - `check_organ_function_dosing` -> renal/hepatic findings
   - `screen_deprescribing` -> deprescribing candidates
4. Synthesizes findings into a unified medication review report
5. Returns results as Talk (narrative summary), Table (risk matrix), Template (deprescribing plans), and Task (pharmacy review items)

### 2.3 SHARP Extension Specs Integration

The MCP server implements SHARP context propagation:

- **Authentication:** API key-based access for marketplace discovery
- **Context Headers:**
  - `X-FHIR-Server-URL` — Target FHIR server
  - `X-FHIR-Access-Token` — Bearer token for FHIR API authorization
  - `X-Patient-ID` — Patient identifier for medication lookup
- **FHIR Context Discovery:** Server advertises `fhir_context_required: true` in initialize response
- **Security:** FHIR credentials never appear in LLM prompts — extracted into tool context at runtime

---

## 3. Data Architecture

### 3.1 Local CYP450 Knowledge Base

**Sources (all publicly available, citable):**
- FDA Table of Substrates, Inhibitors, and Inducers (fda.gov)
- Indiana University Flockhart Table (CYP enzyme classification)
- 2025 Curated CYP450 Interaction Dataset (Nature Scientific Data)

**Coverage:** Top 200 commonly prescribed drugs across 6 major CYP enzymes:
- CYP3A4 (metabolizes ~50% of drugs)
- CYP2D6
- CYP2C9
- CYP2C19
- CYP1A2
- CYP2B6

**Schema:**
```json
{
  "drug": "fluconazole",
  "rxnorm_cui": "4083",
  "cyp_relationships": [
    {"enzyme": "CYP3A4", "role": "strong_inhibitor", "source": "FDA Table 2024"},
    {"enzyme": "CYP2C9", "role": "moderate_inhibitor", "source": "FDA Table 2024"},
    {"enzyme": "CYP2C19", "role": "strong_inhibitor", "source": "FDA Table 2024"}
  ]
}
```

### 3.2 Beers Criteria 2023 (Encoded)

Manually encoded from AGS 2023 publication. ~30 pages of tables covering:
- Potentially inappropriate medications for older adults
- Drug-disease/syndrome interactions
- Medications to avoid in specific conditions
- Drug-drug interactions to avoid

### 3.3 STOPPFrail Criteria (Encoded)

Encoded from published academic papers. Covers medications to consider deprescribing in:
- Frail older adults
- Patients with limited life expectancy
- End-of-life care contexts

### 3.4 Renal/Hepatic Dose Adjustment Tables

Top 50 drugs requiring renal dose adjustment, with thresholds and recommendations. Sourced from FDA product labeling.

---

## 4. FHIR Resource Usage

| FHIR Resource | Usage |
|---------------|-------|
| `Patient` | Demographics (age, weight) |
| `MedicationRequest` | Active medication list with dosing |
| `Observation` | eGFR (LOINC: 33914-3), LFTs (ALT: 1742-6, AST: 1920-8), drug levels |
| `Condition` | Active conditions (for deprescribing context) |
| `AllergyIntolerance` | Drug allergies and cross-reactivity |

---

## 5. Demo Design

### 5-Minute Structure (3-min video)

| Segment | Duration | Content |
|---------|----------|---------|
| Hook | 20 sec | "Physicians receive 200+ drug alerts per day. They override 95% of them. Meanwhile, 1.3 million Americans visit the ER from adverse drug reactions." |
| Split Screen | 30 sec | LEFT: EHR fires 23 alerts for Mrs. Johnson (78yo, 12 meds). Override, override, override. RIGHT: PolyPharmGuard analyzes same patient. |
| Finding 1 | 30 sec | CASCADE: Fluconazole + simvastatin + eGFR 28. Show visual evidence chain. |
| Finding 2 | 20 sec | RENAL DOSE: Metformin contraindicated at eGFR 28. |
| Finding 3 | 20 sec | DEPRESCRIBING: Omeprazole 18 months, no indication. Taper plan. |
| Architecture | 20 sec | MCP + A2A + FHIR + SHARP on Prompt Opinion Platform. |
| Impact | 10 sec | "Not 23 alerts. Three findings. Each one actionable. Each one potentially life-saving." |

### Demo Patient: Mrs. Johnson

- **Age:** 78 years old
- **eGFR:** 28 mL/min (CKD Stage 4)
- **Active medications (12):**
  1. Fluconazole 200mg daily (antifungal)
  2. Simvastatin 40mg daily (cholesterol)
  3. Amlodipine 10mg daily (blood pressure)
  4. Metformin 1000mg BID (diabetes)
  5. Warfarin 5mg daily (anticoagulation)
  6. Omeprazole 40mg daily (PPI - no documented indication)
  7. Gabapentin 300mg TID (neuropathic pain)
  8. Lisinopril 20mg daily (blood pressure/renal protection)
  9. Metoprolol 50mg BID (heart rate)
  10. Aspirin 81mg daily (cardiovascular)
  11. Furosemide 40mg daily (fluid management)
  12. Potassium chloride 20mEq daily (supplement)

---

## 6. Scoring Rationale

### AI Factor: 9/10
- Multi-drug CYP450 cascade reasoning requires LLM pharmacokinetic reasoning — not a lookup table
- Deprescribing recommendations require weighing competing clinical priorities
- Context integration (organ function + medication list + conditions) is a genuine reasoning task
- Every finding includes an auditable evidence chain grounded in verified data

### Potential Impact: 9/10
- 1.3M ED visits from ADRs annually
- 95% alert override rate = broken system
- 40% elderly on polypharmacy
- $30B annual cost
- FDA regulatory pathway clear (21st Century Cures Act CDS exemption)

### Feasibility: 9/10
- MCP-only core (simple architecture)
- All APIs free (openFDA, FHIR, Medical Terminologies MCP)
- CYP450 knowledge base built from public FDA data
- Synthea generates realistic polypharmacy patients
- HAPI FHIR public server for demo
- 33 days is comfortable for 3 tools + thin A2A wrapper

---

## 7. Risk Register

| Risk | Severity | Mitigation |
|------|----------|------------|
| RxNorm Interaction API discontinued (Jan 2024) | HIGH | Build local CYP450 KB from FDA tables + curated datasets |
| LLM hallucination on drug interactions | HIGH | Reason ONLY over verified knowledge base data, not training knowledge. Every link must cite source. |
| SHARP Extension Specs not implemented correctly | HIGH | Implement from day one as infrastructure. Test with Prompt Opinion public endpoints. |
| MCP-only feels like "just a tool" to judges | MEDIUM | Add A2A MedReview Agent wrapper for orchestration demo |
| Incomplete CYP450 knowledge base | MEDIUM | Scope to top 200 drugs across 6 CYP enzymes. Flag unknown drugs as "requires manual review" |
| openFDA FAERS signal-to-noise | LOW | Use FAERS for frequency enrichment only, not primary interaction identification |
| Beers/STOPPFrail encoding errors | LOW | Cross-validate against published criteria. Scope to highest-priority categories. |

---

## 8. Competitive Differentiation

| Us (PolyPharmGuard) | Them (Typical Drug Interaction Tool) |
|---------------------|--------------------------------------|
| Multi-drug cascade reasoning | Pairwise lookup only |
| Patient-specific context (eGFR, hepatic function) | Same alert for every patient |
| 3 actionable findings | 23 ignored alerts |
| Deprescribing recommendations | No deprescribing support |
| Evidence chains with citations | "Interaction found" with no explanation |
| Severity ranked by clinical significance | All alerts treated equally |
| MCP composable (any agent can use) | Locked inside one EHR vendor |

---

## 9. References

- FDA Table of Substrates, Inhibitors, and Inducers: https://www.fda.gov/drugs/drug-interactions-labeling/drug-development-and-drug-interactions-table-substrates-inhibitors-and-inducers
- AGS 2023 Beers Criteria: Journal of the American Geriatrics Society, 2023
- STOPPFrail Criteria: Age and Ageing, 2017 (Updated 2023)
- SHARP on MCP Specification: https://sharponmcp.com/
- MCP Specification: https://modelcontextprotocol.io/specification/2025-11-25
- A2A Protocol: https://a2a-protocol.org/latest/specification/
- openFDA API: https://open.fda.gov/apis/
- HAPI FHIR: https://hapi.fhir.org/
- Synthea: https://github.com/synthetichealth/synthea
