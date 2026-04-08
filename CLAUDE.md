# Project Rules for Claude Code

## Project Overview

**PolyPharmGuard** — A clinical polypharmacy reasoning engine that replaces the broken "alert everything" paradigm with contextual, patient-specific medication safety analysis. Exposes three MCP tools for cascade interaction analysis, organ-function dose checking, and deprescribing screening, orchestrated by a thin A2A MedReview Agent.

### Architecture

- **MCP Server**: TypeScript SDK (po-community-mcp reference) — three clinical reasoning tools
- **A2A Agent**: Google ADK (po-adk-typescript reference) — MedReview Agent orchestrator
- **AI Layer**: Gemini API (Google AI Studio) for pharmacokinetic cascade reasoning + clinical judgment
- **FHIR Integration**: AgentCare or Momentum FHIR MCP + HAPI FHIR (patient data, labs, meds)
- **Knowledge Base**: Local CYP450 KB (FDA tables), Beers Criteria 2023, STOPPFrail, renal/hepatic dosing tables
- **External APIs**: openFDA FAERS (adverse event enrichment), Medical Terminologies MCP (RxNorm, SNOMED, LOINC, ICD-11)
- **Platform**: Prompt Opinion Marketplace (SHARP context + COIN)
- **Guardrails**: NeMo Guardrails / Guardrails AI

### Project Structure

```text
PolyPharmGuard/
├── CLAUDE.md                    # This file — project rules
├── README.md                    # Project overview for hackathon
├── package.json                 # Dependencies and scripts
├── tsconfig.json                # TypeScript configuration
├── docs/
│   ├── polypharmguard-design.md # Primary project design document
│   ├── dischargeguard-design.md # Backup project design
│   └── plans/                   # Implementation plans
├── src/
│   ├── mcp-server/              # MCP server (TypeScript)
│   │   ├── index.ts             # Server entry point + MCP tool registration
│   │   ├── tools/
│   │   │   ├── cascade-interactions.ts    # Tool 1: analyze_cascade_interactions
│   │   │   ├── organ-function-dosing.ts   # Tool 2: check_organ_function_dosing
│   │   │   └── deprescribing-screen.ts    # Tool 3: screen_deprescribing
│   │   ├── sharp/               # SHARP Extension Specs integration
│   │   │   └── context.ts       # FHIR context extraction from SHARP headers
│   │   └── prompts/             # LLM prompt templates for clinical reasoning
│   │       ├── cascade-prompt.ts
│   │       ├── dosing-prompt.ts
│   │       └── deprescribing-prompt.ts
│   ├── a2a-agent/               # A2A MedReview Agent
│   │   ├── index.ts             # Agent entry point
│   │   ├── orchestrator.ts      # Medication review workflow orchestration
│   │   └── agent-card.json      # A2A agent card for discovery
│   ├── knowledge-base/          # Local clinical knowledge data
│   │   ├── cyp450/              # CYP450 enzyme interaction data
│   │   │   ├── substrates.json  # CYP enzyme substrates (top 200 drugs)
│   │   │   ├── inhibitors.json  # CYP enzyme inhibitors
│   │   │   └── inducers.json    # CYP enzyme inducers
│   │   ├── beers-criteria.json  # AGS 2023 Beers Criteria (encoded)
│   │   ├── stoppfrail.json      # STOPPFrail criteria (encoded)
│   │   └── renal-hepatic/       # Dose adjustment tables
│   │       ├── renal-dosing.json
│   │       └── hepatic-dosing.json
│   ├── fhir/                    # FHIR client utilities
│   │   ├── client.ts            # FHIR API client wrapper
│   │   └── queries.ts           # Patient data queries (meds, labs, conditions)
│   ├── llm/                     # LLM integration
│   │   ├── gemini.ts            # Gemini API client
│   │   └── guardrails.ts        # Clinical safety guardrails
│   └── types/                   # TypeScript type definitions
│       ├── clinical.ts          # Clinical data types (drugs, interactions, findings)
│       ├── fhir.ts              # FHIR resource types
│       └── mcp.ts               # MCP tool input/output types
├── data/
│   └── synthea/                 # Synthetic patient data for testing/demo
├── demo/                        # Demo video assets
└── tests/
    ├── tools/                   # Unit tests for MCP tools
    │   ├── cascade.test.ts
    │   ├── dosing.test.ts
    │   └── deprescribing.test.ts
    ├── knowledge-base/          # KB data validation tests
    └── e2e/                     # End-to-end tests with synthetic patients
```

### Key Technical Decisions

- **MCP Server (TypeScript)** is the core deliverable — three clinical reasoning tools exposed via Model Context Protocol
- **Local CYP450 Knowledge Base** is architecturally load-bearing — all cascade reasoning grounds on verified FDA data, not LLM training knowledge
- **SHARP context propagation** is infrastructure — FHIR credentials flow via `X-FHIR-Server-URL`, `X-FHIR-Access-Token`, `X-Patient-ID` headers, never in LLM prompts
- **Gemini for clinical reasoning** — LLM reasons ONLY over verified knowledge base data. Every finding must cite its source
- **A2A MedReview Agent** is a thin orchestrator — composes the three MCP tools into a unified medication review workflow
- **Synthea for demo patients** — realistic polypharmacy patients with real FHIR data, zero PHI concerns
- **openFDA FAERS for enrichment only** — frequency data supplements findings but never drives primary interaction identification

### Three MCP Tools

| Tool | Purpose | Input | Output |
|------|---------|-------|--------|
| `analyze_cascade_interactions` | Detect multi-drug CYP450 pharmacokinetic cascades | Medication list + patient context | Ranked findings with evidence chains |
| `check_organ_function_dosing` | Cross-reference dosing against organ function | Medications + eGFR/LFTs from FHIR | Dose adjustment recommendations |
| `screen_deprescribing` | Identify deprescribing candidates | Medications + demographics + conditions | Prioritized recommendations with taper plans |

### 5Ts Output Coverage

| Output Type | Example |
|-------------|---------|
| **Talk** | "Warning: metformin is contraindicated with current eGFR of 28" |
| **Template** | Deprescribing plan with 4-week taper schedule |
| **Table** | Medication risk matrix (drug x risk-factor grid) |
| **Transaction** | FHIR MedicationRequest updates for dose adjustments |
| **Task** | Pharmacy review tasks for flagged interactions |

## Auto-Commit and Push Rule

**MANDATORY**: After every change you make to any file in this repository, you MUST:

1. Stage the changed files: `git add <specific files you changed>`
2. Commit with a clear message describing what changed: `git commit -m "description of change"`
3. Push to remote: `git push origin main`

This applies to EVERY change — no exceptions. Do not batch changes. Commit and push immediately after each logical change.

- Never force push
- Use descriptive commit messages that explain the "why"
- If a pre-commit hook fails, fix the issue and create a NEW commit (never amend)

## Branching & Commit Conventions

- **Main branch**: `main`
- **Commit format**: Conventional Commits
  - `feat:` / `feat(scope):` — new feature
  - `fix:` / `fix(scope):` — bug fix
  - `docs:` — documentation
  - `refactor:` — code refactoring
  - `chore:` — build/tooling changes
  - `test:` — test changes
- **Scopes**: `mcp`, `a2a`, `cascade`, `dosing`, `deprescribing`, `fhir`, `sharp`, `kb`, `llm`, `guardrails`, `demo`

## Build & Test Commands

```bash
# Development
npm run dev                     # Start MCP server in development mode
npm run build                   # Compile TypeScript
npm run start                   # Start production MCP server

# Knowledge Base
npm run generate:kb             # Build local CYP450 knowledge base from FDA data
npm run validate:kb             # Validate knowledge base data integrity

# A2A Agent
npm run agent:dev               # Start A2A MedReview Agent (dev mode)
npm run agent:start             # Start A2A MedReview Agent (production)

# Lint & Format
npm run lint                    # ESLint check
npx prettier --check .          # Format check
npx prettier --write .          # Auto-format

# Test
npm run test                    # Run all tests
npm run test:unit               # Unit tests only (tools + KB validation)
npm run test:e2e                # End-to-end tests with synthetic patients
```

## Environment Variables

Required in `.env`:

```bash
# Gemini (Clinical Reasoning LLM)
GEMINI_API_KEY=                  # Google AI Studio API key

# FHIR Server
FHIR_SERVER_URL=                 # e.g., https://hapi.fhir.org/baseR4
FHIR_ACCESS_TOKEN=               # Bearer token for FHIR API authorization
PATIENT_ID=                      # Test patient identifier

# MCP Server
MCP_PORT=3000                    # MCP server port

# A2A Agent
A2A_AGENT_PORT=8000              # A2A agent port

# Prompt Opinion Platform
PROMPT_OPINION_API_KEY=          # Marketplace authentication

# openFDA
OPENFDA_API_KEY=                 # Optional — increases rate limits (free)

# Guardrails (optional)
NEMO_GUARDRAILS_CONFIG=          # Path to guardrails config
```

## Agent Team Strategy

Use agent teams for any task that benefits from parallel work across independent modules. Teams are enabled via `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in settings.

### When to Use Teams

- Multi-file features spanning MCP tools, A2A agent, and knowledge base
- Research + implementation in parallel (one teammate explores FDA data, another builds tool logic)
- Code review with competing perspectives (clinical accuracy, security, performance)
- Debugging with competing hypotheses — teammates test different theories simultaneously
- Any task with 3+ independent subtasks that don't touch the same files

### When NOT to Use Teams

- Sequential tasks with heavy dependencies between steps
- Changes to a single file or tightly coupled files
- Simple bug fixes or small tweaks
- Tasks where coordination overhead exceeds the benefit

### Team Configuration

- Start with **3-5 teammates** for most workflows
- Aim for **5-6 tasks per teammate** to keep everyone productive
- Use **Opus for the lead** (reasoning/coordination), **Sonnet for teammates** (focused implementation)
- Use **delegate mode** (`Shift+Tab`) when the lead should only coordinate, not write code

### Team Communication Rules

- Use `SendMessage` (type: "message") for direct teammate communication — always refer to teammates by **name**
- Use `SendMessage` (type: "broadcast") **only** for critical blockers affecting everyone
- Use `TaskCreate`/`TaskUpdate`/`TaskList` for work coordination — teammates self-claim unblocked tasks
- When a teammate finishes, they check `TaskList` for the next available task (prefer lowest ID first)
- Mark tasks `completed` only after verification passes

### Task Dependencies

- Use `addBlockedBy` to express task ordering (e.g., "cascade tool depends on CYP450 KB being done")
- Teammates skip blocked tasks and pick up unblocked work
- When a blocking task completes, dependent tasks auto-unblock

### Parallelizable Modules

These can be built simultaneously with zero conflicts:

- **Three MCP tools** (cascade, dosing, deprescribing) — different files, independent logic
- **Knowledge base datasets** (CYP450, Beers, STOPPFrail, renal/hepatic) — separate JSON files
- **FHIR client** and **LLM client** — independent utility modules
- **Tests** — each tool has its own test file

### Sequential Dependencies

These must be done in order:

1. Knowledge base data (CYP450, Beers, STOPPFrail) — blocks all three tools
2. FHIR client + SHARP context extraction — blocks tools that need patient data
3. LLM integration (Gemini) — blocks cascade reasoning tool
4. Three MCP tools (can be parallel after dependencies resolve)
5. A2A MedReview Agent (depends on all three MCP tools working)
6. Prompt Opinion Marketplace publishing (depends on everything)

### Team Roles

- **Lead**: Architecture decisions, SHARP setup, project scaffold
- **Tool Dev 1**: `analyze_cascade_interactions` + CYP450 knowledge base
- **Tool Dev 2**: `check_organ_function_dosing` + renal/hepatic dosing tables
- **Tool Dev 3**: `screen_deprescribing` + Beers/STOPPFrail encoding
- **Integration Dev**: FHIR client, Gemini LLM client, A2A agent orchestrator
- **Devil's Advocate**: Clinical accuracy review, edge cases, demo testing

### Plan Approval for Risky Work

- For architectural changes or risky refactors, require **plan approval** before implementation
- The teammate works in read-only mode, submits a plan, lead approves/rejects
- Only after approval does the teammate implement

### Shutdown Protocol

- When all tasks are complete, the lead sends `shutdown_request` to each teammate
- Teammates approve shutdown after confirming their work is committed
- Lead calls `TeamDelete` to clean up team resources

## Workflow Orchestration

### 1. Plan Mode Default

- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately — don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy

- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

### 3. Verification Before Done

- Never mark a task complete without proving it works
- Run `npm run build` to verify no TypeScript errors
- Test each MCP tool with the demo patient (Mrs. Johnson) end-to-end
- Validate knowledge base data against FDA source documents
- Verify SHARP headers propagate correctly through the stack
- Ask: "Would a hackathon judge be impressed by this?"

### 4. Demo-Driven Development

- Every feature should be demo-able in the 3-minute video
- If a feature isn't visible in the demo, deprioritize it
- Polish > breadth — 3 working tools with deep clinical reasoning beat 6 shallow ones
- Mrs. Johnson (78yo, 12 meds, eGFR 28) is the demo patient — optimize for her scenario

### 5. Demand Elegance (Balanced)

- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes — don't over-engineer

### 6. Autonomous Bug Fixing

- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests — then resolve them
- Zero context switching required from the user
- Go fix failing CI tests without being told how

### 7. Self-Improvement Loop

- After ANY correction from the user: capture the pattern
- Write rules for yourself that prevent the same mistake
- Review lessons at session start for relevant context

## Task Management

1. **Plan First**: Write plan with checkable items before starting
2. **Verify Plan**: Check in before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Document Results**: Review what was built and what changed

## Clinical Data Integrity Rules

- **LLM reasons ONLY over verified knowledge base data** — never rely on LLM training knowledge for drug interactions, dosing, or clinical facts
- **Every finding must cite its source** — FDA table, Beers Criteria publication, FHIR Observation, or FAERS query
- **Evidence chains are mandatory** — each step in a cascade finding must have a cited fact
- **Flag unknown drugs** as "requires manual review" — never fabricate CYP450 relationships
- **FHIR credentials never appear in LLM prompts** — extracted into tool context at runtime via SHARP headers
- **openFDA FAERS is enrichment only** — frequency data supplements findings, never drives primary identification
- **Beers/STOPPFrail encoding must be cross-validated** against published criteria before use

## Core Principles

- **Hackathon Speed**: Ship fast, iterate. Perfect is the enemy of done.
- **Knowledge Base First**: Every clinical assertion MUST ground on verified data. No hallucinated drug interactions.
- **Demo-Driven**: If it doesn't show well in 3 minutes, cut it.
- **Context is the Product**: Patient-specific analysis IS the differentiator — eGFR, hepatic function, age, conditions. Make it obvious.
- **No Faking**: Real FHIR data, real CYP450 cascades, real FDA citations. Judges notice mocks.
- **Simplicity First**: Make every change as simple as possible. Minimal code impact.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.
- **Clinical Safety**: This is healthcare software. When in doubt, flag for manual review rather than making assumptions.
