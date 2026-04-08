# DischargeGuard - Backup Project Design Document

**Project:** DischargeGuard - Post-Discharge Care Coordination Agent
**Hackathon:** Agents Assemble - The Healthcare AI Endgame
**Track:** Both (MCP Server + A2A Agent)
**Status:** BACKUP PROJECT (Primary: PolyPharmGuard)
**Date:** April 8, 2026

---

## Executive Summary

DischargeGuard is a post-discharge care coordination agent that monitors patients for 30 days after hospital discharge, detects early warning signs of readmission from patient-reported symptoms and FHIR vitals, and autonomously escalates to care teams. It combines an MCP server exposing discharge tools with A2A agents for monitoring, risk scoring, and escalation.

**When to switch to this project:** If PolyPharmGuard encounters a fatal technical blocker (e.g., cannot assemble reliable CYP450 knowledge base) within the first week.

---

## 1. Problem Statement

- Hospital readmissions within 30 days cost the US healthcare system **$26 billion annually**
- CMS penalizes hospitals **up to 3%** of Medicare reimbursements for excess readmissions (HRRP)
- **27% of readmissions are preventable** with adequate follow-up
- After discharge, patients fall into a "care vacuum" — no one monitors whether they filled prescriptions, understood wound care, or developed complications
- Past hackathon winner "AdvocateGPT" proved judges value post-discharge solutions, but only provided static discharge summaries

---

## 2. Solution Design

### 2.1 MCP Server: DischargeGuard-MCP

Exposes three tools:

#### Tool 1: `generate_discharge_plan`
- Pulls discharge encounter data from FHIR (Encounter, Condition, MedicationRequest, Procedure)
- Generates personalized discharge instructions at 6th-grade reading level
- Creates a 30-day monitoring plan with milestone checkpoints
- Outputs as Template

#### Tool 2: `calculate_readmission_risk`
- Computes LACE index (Length of stay, Acuity, Comorbidities, ED visits in past 6 months) from FHIR data
- Stratifies patient into risk tiers (low/medium/high)
- Determines monitoring intensity (daily vs every-3-days vs weekly check-ins)
- Outputs as Table

#### Tool 3: `reconcile_medications`
- Pulls pre-admission, inpatient, and discharge medication lists from FHIR
- Identifies discrepancies (new medications, stopped medications, dose changes)
- Checks for drug interactions using RxNorm
- Generates patient-friendly medication change summary
- Outputs as Template

### 2.2 A2A Agents

#### Monitoring Agent (Port 8001)
- Initiates daily/periodic check-ins with patients via Talk output
- Asks diagnosis-specific symptom questions (e.g., heart failure: daily weight, shortness of breath, edema)
- Collects free-text symptom reports
- Uses Amazon Comprehend Medical to extract clinical entities from patient responses

#### Risk Scoring Agent (Port 8002)
- Ingests patient responses from Monitoring Agent
- Cross-references against clinical deterioration patterns using Gemini
- Updates real-time risk dashboard (Table output)
- Pulls latest labs/vitals from FHIR if available

#### Escalation Agent (Port 8003)
- Triggers when risk score exceeds threshold
- Creates a Task for the care team with clinical summary
- Generates a Transaction (FHIR Communication resource) routed to care coordination team
- Handles medication adherence alerts (RxNorm cross-checks for new OTC medications)

#### Orchestrator Agent (Port 8004)
- Routes requests to appropriate sub-agent
- Manages the overall discharge follow-up workflow
- Demonstrates A2A multi-agent coordination

---

## 3. Architecture

```
User/Clinician
      |
      | A2A
      v
+---------------------+
| Orchestrator Agent   |
| (Routes workflows)   |
+-----+-------+-------+
      |       |       |
      v       v       v
+------+ +------+ +--------+
| Mon. | | Risk | | Escal. |
| Agent| | Agent| | Agent  |
+--+---+ +--+---+ +---+----+
   |        |          |
   +--------+----------+
            | MCP
   +--------v---------+
   | DischargeGuard-MCP|
   | (3 tools)         |
   +--------+----------+
            |
   +--------v---------+
   | FHIR MCP Server   |
   | + RxNorm + openFDA |
   +-------------------+
```

---

## 4. 5Ts Coverage

| Output Type | Example |
|-------------|---------|
| **Talk** | Daily patient check-in: "How are you feeling today? Any new swelling in your ankles?" |
| **Template** | Personalized discharge instructions + medication change summary |
| **Table** | 30-day risk trajectory dashboard for care team |
| **Transaction** | FHIR Communication resource for escalation |
| **Task** | Follow-up tasks assigned to care team members |

---

## 5. FHIR Resources Used

| Resource | Usage |
|----------|-------|
| `Encounter` | Discharge encounter details, length of stay |
| `Condition` | Discharge diagnoses for monitoring protocols |
| `MedicationRequest` | Discharge medications for reconciliation |
| `Procedure` | Procedures performed during admission |
| `Observation` | Vitals, labs for risk scoring |
| `CarePlan` | Follow-up care plan |
| `Communication` | Escalation messages to care team |
| `Appointment` | Follow-up appointment scheduling |

---

## 6. Scoring Rationale

| Criterion | Score | Reasoning |
|-----------|-------|-----------|
| AI Factor | 8/10 | GenAI for symptom interpretation, risk prediction, personalized instructions. Less novel than cascade reasoning. |
| Impact | 9/10 | $26B readmission cost, CMS penalties, 27% preventable. Life-or-death for some patients. |
| Feasibility | 8/10 | Well-understood workflow, but broader scope than PolyPharmGuard. More moving parts. |
| **Total** | **25/30** | |

---

## 7. Why This Is the Backup (Not Primary)

1. **Broader scope** = higher build risk in 33 days
2. **Demo compression challenge** — multi-day workflow hard to show in 3 minutes
3. **Patient-facing AI** raises liability questions judges will ask
4. **AI Factor slightly lower** — much of the follow-up protocol is rule-based (call on day 1, 3, 7)
5. **PolyPharmGuard has tighter scope**, higher feasibility, and a more visceral demo moment

---

## 8. When to Switch

Switch to DischargeGuard ONLY if:
- CYP450 knowledge base cannot be assembled by end of Week 1
- SHARP integration with MCP server encounters a platform blocker
- Team discovers PolyPharmGuard's core value proposition is already built by another team on the marketplace

**Decision deadline:** April 15, 2026 (end of Week 1). After that, commit fully to whichever project is chosen.

---

## 9. Tech Stack

Same as PolyPharmGuard (all free):
- TypeScript MCP SDK + Google ADK (A2A)
- Gemini via Google AI Studio
- FHIR MCP servers + HAPI FHIR
- Amazon Comprehend Medical (free tier for NLP)
- RxNorm + openFDA
- Synthea for synthetic discharge patients
- Prompt Opinion Marketplace

---

## 10. References

- CMS Hospital Readmissions Reduction Program: https://www.cms.gov/medicare/payment/prospective-payment-systems/acute-inpatient-pps/hospital-readmissions-reduction-program-hrrp
- LACE Index: https://pubmed.ncbi.nlm.nih.gov/20194559/
- SHARP on MCP: https://sharponmcp.com/
- Agents Assemble Hackathon: https://agents-assemble.devpost.com/
