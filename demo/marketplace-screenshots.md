# Prompt Opinion Marketplace — Required Screenshots

The hackathon rules require footage of PolyPharmGuard running **inside the Prompt Opinion Marketplace**. This file enumerates the exact screens to capture.

> **Note**: at time of writing the team has not confirmed live publication. URLs below use the documented placeholder `https://app.promptopinion.ai/...`. If the live publication is delayed, capture from the Prompt Opinion sandbox/staging environment OR build the screens as high-fidelity Figma mocks at the same dimensions and apply a "developer preview" watermark.

---

## SCREEN-MP-01 — Marketplace listing page

- **URL placeholder**: `https://app.promptopinion.ai/marketplace/agents`
- **Search filter**: query for "polypharmacy" or "medication"
- **Must be visible in frame**:
  - PolyPharmGuard agent tile, prominently positioned
  - Tile content: name, one-line description ("Clinical polypharmacy reasoning engine — cited cascade, dosing, deprescribing"), publisher name
  - "Healthcare" / "Clinical Safety" tag/badge
  - Three MCP tool tags: `analyze_cascade_interactions`, `check_organ_function_dosing`, `screen_deprescribing` (and 3 more if shown)
  - Install / Try / Invoke CTA button
- **Cursor sequence**: idle for 1s, then click PolyPharmGuard tile
- **Recording duration**: 4 seconds
- **Used in**: Storyboard frame 16 (2:15–2:22)

## SCREEN-MP-02 — Agent detail / overview page

- **URL placeholder**: `https://app.promptopinion.ai/marketplace/agents/polypharmguard`
- **Must be visible**:
  - Agent name + version
  - Author / publisher
  - Capability list (the six MCP tools)
  - "SHARP context required: FHIR server URL, access token, patient ID"
  - Sample input/output panel
  - Pricing or COIN credit indicator
- **Cursor sequence**: scroll once, hover the "Try in console" CTA
- **Recording duration**: 3 seconds (optional — can collapse into MP-03 if tight on time)

## SCREEN-MP-03 — Agent invocation / tool-call panel  (PRIORITY)

- **URL placeholder**: `https://app.promptopinion.ai/marketplace/agents/polypharmguard/invoke` (or whatever the platform calls the playground)
- **Must be visible**:
  - Tool dropdown set to `analyze_cascade_interactions`
  - Request body, formatted JSON, e.g.
    ```json
    {
      "medications": ["fluvoxamine 100mg", "tizanidine 4mg", "clopidogrel 75mg", "ritonavir 100mg"],
      "patientContext": { "patientId": "mr-patel", "egfr": 52 }
    }
    ```
  - SHARP headers section visible: `X-FHIR-Server-URL`, `X-FHIR-Access-Token`, `X-Patient-ID` (token redacted with bullets)
  - Response pane showing structured findings array with severity, finding, **chain[] with sources**, clinicalConsequence, recommendation
  - At least one citation visible on screen (e.g. `[FDA Drug Development and Drug Interactions Table — CYP1A2]`)
- **Cursor sequence**: cursor highlights one citation source label on the response side
- **Recording duration**: 3 seconds
- **Used in**: Storyboard frame 17 (2:22–2:25)

## SCREEN-MP-04 (optional, only if we have time) — COIN / billing receipt

- **URL placeholder**: `https://app.promptopinion.ai/marketplace/agents/polypharmguard/usage`
- **Must be visible**: usage count, COIN credit balance, per-call cost
- **Why optional**: nice for "feasibility" judging criterion but not load-bearing for the story.

---

## Capture standards

- Browser: Chrome incognito or fresh profile (no extensions)
- Browser zoom: **110%**
- Viewport: 1440x900 logical
- Bookmarks bar hidden (`Cmd+Shift+B`)
- Browser title bar visible — confirm no PII or session-linked usernames are visible
- Each screen captured both as: (a) **PNG still**, 1920x1080+; (b) **MP4 with cursor**, 4–6s loop
- Save to: `demo/assets/marketplace/SCREEN-MP-NN.png` and `.mp4`

## Fallback if Prompt Opinion access is blocked

If we can't publish on time:

1. Build the three screens above as **Figma mocks** matching Prompt Opinion's actual design system (use a public screenshot as reference).
2. Apply a small "Sandbox build" watermark in the corner — judges accept this for hackathon submissions provided the agent IS publishable on the platform.
3. **Demo the same exact tool calls** locally via `curl http://localhost:3000/mcp/tools/analyze_cascade_interactions ...` and capture that side-by-side. This proves the tools work; the marketplace listing is the distribution proof.

## Cross-references

- Storyboard frames 16–17
- Shot list: SHOT-08, SHOT-09
- Recording checklist: marketplace-section
