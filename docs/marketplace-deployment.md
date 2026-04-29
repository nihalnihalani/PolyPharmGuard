# PolyPharmGuard — Marketplace Deployment Runbook

Step-by-step guide to take PolyPharmGuard from a local checkout to a public,
discoverable, and invokable entry on the **Prompt Opinion Marketplace**
(<https://app.promptopinion.ai>). This is the runbook used to clear the
hackathon's Stage 1 PASS/FAIL gate.

> **Audience:** the deployment engineer running through this for the first
> time. Every command below is verbatim — copy/paste from a clean working
> directory.

---

## 0. Prerequisites

| Tool | Version | Why |
|------|---------|-----|
| Node | ≥ 20 | Runtime + TypeScript compiler |
| npm | ≥ 10 | Package manager |
| Docker | ≥ 24 | Container build for hosting |
| `curl` | any | Smoke-testing /health |

You will also need:

- A **Google AI Studio** API key for `GEMINI_API_KEY`.
- A **Prompt Opinion** account at <https://app.promptopinion.ai> and an
  API key issued from your account dashboard (`PROMPT_OPINION_API_KEY`).
- A public hostname for the MCP server (Cloud Run, Fly.io, Railway, Render,
  or your own VM). Anything that can run a Docker container and expose port
  3000 over HTTPS works.

---

## 1. Local sanity check (stdio transport)

```bash
cp .env.example .env
# Edit .env: set GEMINI_API_KEY at minimum.

npm ci
npm run build
npm test          # 70/70 must pass
npm run dev       # boots stdio MCP server — Ctrl+C to stop
```

If any of those fail, stop and fix locally before going further.

---

## 2. Local sanity check (HTTP transport)

```bash
npm run dev:http
```

In another terminal:

```bash
curl -s http://localhost:3000/health | jq
# -> {"status":"ok","service":"polypharmguard","transport":"streamable-http",...}

# MCP initialize handshake (proves /mcp speaks the protocol):
curl -s -X POST http://localhost:3000/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{
        "protocolVersion":"2025-06-18",
        "capabilities":{},
        "clientInfo":{"name":"smoketest","version":"1.0.0"}}}'
```

The response should include the server's protocol version and the list of
six tools. The `Mcp-Session-Id` header on the response is used for follow-up
requests.

### SHARP context smoke test

Confirm SHARP headers actually flow through. Pick any tool that resolves
FHIR context (e.g. `analyze_cascade_interactions`) and call it with the
three SHARP headers set:

```bash
SESSION=$(curl -si -X POST http://localhost:3000/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{
        "protocolVersion":"2025-06-18","capabilities":{},
        "clientInfo":{"name":"st","version":"1"}}}' \
  | grep -i mcp-session-id | awk '{print $2}' | tr -d '\r')

curl -s -X POST http://localhost:3000/mcp \
  -H "Mcp-Session-Id: $SESSION" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'X-FHIR-Server-URL: https://hapi.fhir.org/baseR4' \
  -H 'X-FHIR-Access-Token: dummy-token' \
  -H 'X-Patient-ID: mrs-johnson-001' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{
        "name":"analyze_cascade_interactions",
        "arguments":{"medications":["Fluconazole 200mg","Simvastatin 40mg"]}}}'
```

Server logs should show no `[MCP] FHIR context fetch failed: missing config`
errors — the headers were extracted and passed via AsyncLocalStorage to
`resolveFHIRContext()`.

---

## 3. Build and test the Docker image

```bash
docker build -t polypharmguard:1.0.0 .

docker run --rm -p 3000:3000 \
  -e GEMINI_API_KEY="$GEMINI_API_KEY" \
  polypharmguard:1.0.0

# In another terminal:
curl -s http://localhost:3000/health
```

The container starts in HTTP mode by default (`MCP_TRANSPORT=http` baked
into the image) and exposes port 3000.

---

## 4. Push the image

Pick any registry. Examples:

```bash
# Google Artifact Registry
gcloud auth configure-docker us-docker.pkg.dev
docker tag polypharmguard:1.0.0 \
  us-docker.pkg.dev/$PROJECT/polypharmguard/server:1.0.0
docker push us-docker.pkg.dev/$PROJECT/polypharmguard/server:1.0.0

# GitHub Container Registry
docker tag polypharmguard:1.0.0 \
  ghcr.io/nihalnihalani/polypharmguard:1.0.0
docker push ghcr.io/nihalnihalani/polypharmguard:1.0.0
```

---

## 5. Deploy publicly

Any HTTPS-capable container host works. Cloud Run is the cheapest path:

```bash
gcloud run deploy polypharmguard \
  --image us-docker.pkg.dev/$PROJECT/polypharmguard/server:1.0.0 \
  --region us-central1 \
  --port 3000 \
  --allow-unauthenticated \
  --set-env-vars MCP_TRANSPORT=http \
  --set-secrets GEMINI_API_KEY=gemini-api-key:latest
```

Note the resulting URL, e.g. `https://polypharmguard-abc123-uc.a.run.app`.
**Do NOT register the marketplace entry pointing at `localhost`.**

Smoke-test the public URL:

```bash
curl -s https://polypharmguard-abc123-uc.a.run.app/health
```

---

## 6. Register on Prompt Opinion Marketplace

The repo ships `marketplace.yaml` as the canonical manifest. There are two
ways to publish it; **the manual UI path is the verified one for this
hackathon submission**.

### 6a. Manual UI registration (recommended)

1. Sign in at <https://app.promptopinion.ai>.
2. Navigate to **My Entries → New Entry → MCP Server**.
3. Fill in the form, copying values from `marketplace.yaml`:
   - **Name**: `polypharmguard`
   - **Display Name**: `PolyPharmGuard`
   - **Category**: `Healthcare`
   - **Description**: paste the `description:` block.
   - **MCP Endpoint URL**: `https://<your-hostname>/mcp`
   - **Health Check URL**: `https://<your-hostname>/health`
   - **Transport**: `Streamable HTTP`
   - **Required env vars**: `GEMINI_API_KEY` (secret).
   - **Tags**: copy from `metadata.tags`.
4. In the **A2A Agent** section, paste the contents of
   `src/a2a-agent/agent-card.json` (it already conforms to A2A 0.2).
5. Submit. The marketplace probes `/health` to verify the entry is live;
   you should see a green "Reachable" badge within ~30 seconds.
6. Click **Test Tools**. The marketplace will run an `initialize` handshake
   followed by a `tools/list` and show all six tools.

### 6b. Programmatic publish (best-effort)

A wrapper script is included for convenience but **its endpoint and payload
shape have not been verified against a live Prompt Opinion API** from inside
this build — the script logs the URL it is about to hit and the response
body verbatim so you can correct course on the first attempt:

```bash
export PROMPT_OPINION_API_KEY=...   # from your PO account dashboard
npm run publish:po
```

If the script returns a 4xx, override either of these and retry:

```bash
PROMPT_OPINION_API_URL=https://app.promptopinion.ai \
PROMPT_OPINION_PUBLISH_PATH=/api/v1/marketplace/entries \
npm run publish:po
```

If you cannot find the right endpoint, **fall back to step 6a**. The
marketplace UI accepts the same data and is the definitive registration
surface.

---

## 7. Verify Stage 1 PASS

Stage 1 of the hackathon judging requires that the entry be both:

1. **Discoverable**: the entry shows up in marketplace search for "polypharmacy",
   "medication review", or "CYP450".
2. **Invokable**: Prompt Opinion's hosted Claude/Gemini can call any of the six
   MCP tools end-to-end and get a structured response.

Run this end-to-end test from the marketplace's "Try it" panel:

```text
Tool: analyze_cascade_interactions
Args: {
  "medications": [
    "Fluconazole 200mg",
    "Simvastatin 40mg",
    "Amiodarone 200mg"
  ]
}
```

Expected: at least one CRITICAL finding citing CYP3A4 inhibition with a
full evidence chain.

---

## 8. Optional — A2A MedReview Agent

The A2A orchestrator runs separately on port 8000. To expose it:

```bash
# Local
A2A_AGENT_PORT=8000 GEMINI_API_KEY=... node dist/src/a2a-agent/index.js

# Public via the same Docker pattern (override CMD / build a second image
# with CMD ["node","dist/src/a2a-agent/index.js"]).
```

Its agent card is served at `/.well-known/agent.json` and conforms to
A2A 0.2 (`protocolVersion: "0.2.0"`, `preferredTransport: JSONRPC`,
populated `capabilities`, `defaultInputModes`/`defaultOutputModes`, and
per-skill `inputModes`/`outputModes`).

---

## 9. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `npm run start` exits immediately | wrong path in package.json | `main` and `start` now point at `dist/src/mcp-server/index.js` after the deployment refactor; rebuild with `npm run build`. |
| Marketplace shows "unreachable" | `/health` not on HTTPS / wrong port | Confirm public URL returns 200 from outside your network. |
| Tool call returns "missing FHIR config" | SHARP headers not propagated | Check the request actually carries `X-FHIR-Server-URL`, `X-FHIR-Access-Token`, `X-Patient-ID`. The transport extracts them in `http-transport.ts`; AsyncLocalStorage in `sharp/context.ts` is what hands them to `resolveFHIRContext()`. |
| `publish:po` returns 401 | `PROMPT_OPINION_API_KEY` missing or expired | Re-issue from the dashboard; do not commit it. |
| `publish:po` returns 404 | endpoint shape unverified | Use the manual UI path (step 6a). |

---

## 10. Known unknowns

- **Prompt Opinion publish API**: the exact `POST` URL, payload format
  (YAML vs. JSON wrapper), and required headers for programmatic upload
  could not be confirmed from inside the build sandbox. The manual UI flow
  is the authoritative path for hackathon submission. `marketplace.yaml`
  remains the single source of truth either way.
- **DNS-rebinding protection**: not enabled on the HTTP transport. If
  required by Prompt Opinion's marketplace probe, set `allowedHosts` in
  `StreamableHTTPServerTransport` options inside `http-transport.ts`.
