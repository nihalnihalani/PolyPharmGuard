# PolyPharmGuard — Recording Day Checklist

Run through this top-to-bottom **before** hitting record. Estimated setup time: 25 minutes.

---

## A. Gating items (record CANNOT begin until these are green)

- [ ] **Mr. Patel synthea bundle exists** at `data/synthea/mr-patel/` with patient.json, medications.json (must include fluvoxamine, tizanidine, clopidogrel, recent ritonavir), conditions.json, observations.json (CrCl ≈ 52). Without this, SHOT-05 cannot be recorded. Owned by Tool Dev 1 (Agent 3).
- [ ] **`/batch` queue includes Mr. Patel as top row** with risk 81 CRITICAL. Edit `web/app/batch/page.tsx` `DEMO_PATIENTS` array.
- [ ] **`/review/mr-patel` returns 200** with at least 4 cited cascade findings — verify with `curl http://localhost:3001/api/review/mr-patel | jq '.findings.cascade | length'`
- [ ] **`/review/mrs-johnson` returns 200** with fluconazole-simvastatin cascade present
- [ ] **`/api/cds-hooks` POST returns at least one critical card** with the Mr. Patel context — capture the exact response into `demo/assets/cds-hooks-response.json`
- [ ] **All 70 tests pass**: `npm run test` (per project memory: "70 tests")
- [ ] **`npm run build` clean** — no TypeScript errors

## B. Browser setup

- [ ] Chrome (latest stable). Quit and relaunch with no extensions: `chrome --disable-extensions`
- [ ] **Zoom level: 110%** (`Cmd +` once from 100%) on every page before recording
- [ ] **Bookmarks bar hidden**: `Cmd+Shift+B`
- [ ] **Profile selector hidden**: use Guest mode or default solo profile
- [ ] **Devtools closed**, console clean — open and clear once, then close (`Cmd+Opt+J` to verify, then `Cmd+Opt+I` to close)
- [ ] **Browser window size**: 1440x900 logical (use [Spectacle](https://www.spectacleapp.com) or `Rectangle` "Maximize" then resize). Maintain identical window size for every shot.
- [ ] **Title bar URL**: if running on `localhost:3001`, either:
  - (a) add `127.0.0.1 polypharmguard.local` to `/etc/hosts` and proxy via `local-ssl-proxy` so the bar reads `polypharmguard.local`, OR
  - (b) hide the URL bar with Chrome "App Mode" (`open -a "Google Chrome" --args --app=http://localhost:3001/`), OR
  - (c) plan to crop or blur the URL bar in post.

## C. Screen / OS setup

- [ ] **macOS dock**: hidden (`Cmd+Opt+D`)
- [ ] **Menu bar**: hide via Bartender/Hidden Bar OR use full-screen browser app mode
- [ ] **Notifications**: Do Not Disturb ON (Focus mode → Do Not Disturb)
- [ ] **Wallpaper**: solid dark color in case anything peeks through
- [ ] **Display scaling**: confirm 1920x1080+ effective recording resolution. If on a Retina, recording at "Looks like 1440x900" outputs 2880x1800 — fine.
- [ ] **Multi-monitor**: disconnect external displays during recording to avoid mouse drift

## D. App / data setup

- [ ] **Dev server running**: `cd web && npm run dev` — verify on `http://localhost:3001`
- [ ] **MCP server running** if needed for marketplace shots: `npm run dev` from project root
- [ ] **Gemini API key set** in `.env` (real key, not placeholder)
- [ ] **HAPI FHIR / Synthea data**: route `/api/review/mr-patel` returns expected fluvoxamine/tizanidine/clopidogrel cascade
- [ ] **Cache warmed**: visit each of `/`, `/batch`, `/review/mr-patel`, `/review/mrs-johnson`, `/patient-summary/mrs-johnson` once before recording so initial-load is fast

## E. OBS / capture tool settings

- [ ] **OBS scene**: single Display Capture source, cropped to browser window only
- [ ] **Output resolution**: 1920x1080 minimum, 60fps
- [ ] **Bitrate**: 12000 kbps for crisp text
- [ ] **Encoder**: hardware (Apple Silicon) or x264 fast
- [ ] **Audio**: separate audio track, mic only (no system audio for pure VO)
- [ ] **Cursor enhancement**: enable "highlight cursor" in macOS Accessibility OR use [Cursor Pro](https://github.com/cursorpro) — yellow ring, 1.3x size
- [ ] **Test record**: 10-second test of `/`, play back, verify cursor visible, text crisp at 720p downscale

## F. Microphone / VO

- [ ] Record VO **separately** from screen — record full VO first, edit screen capture to match. Easier than the reverse.
- [ ] Mic check: use `narration.md` first paragraph as a level test
- [ ] Quiet environment: HVAC off, phone silenced
- [ ] Headphones on for monitoring, but unplugged from playback path
- [ ] If TTS: use ElevenLabs voice "Adam" or "Rachel", stability 50%, similarity 75%, render to 48kHz WAV

## G. Redaction / privacy pass

- [ ] **No real patient data** anywhere on screen — only synthea fixtures (Mr. Patel, Mrs. Johnson)
- [ ] **No FHIR access tokens visible** — confirm `X-FHIR-Access-Token` headers are bulleted/redacted in any tool-call panel
- [ ] **No real Gemini / OpenAI API keys** in any URL bar, config preview, or env-file glimpse
- [ ] **No real email / Slack / GitHub usernames** in browser titlebar, profile menu, or notifications
- [ ] **Localhost ports blurred OR replaced** with `polypharmguard.local` (see B above)
- [ ] Console clean — no stack traces or 404s in the DevTools tab if it shows briefly during page transitions
- [ ] No `/Users/<your-name>/...` paths visible anywhere

## H. Recording order

1. SHOT-03 `/`
2. SHOT-04 `/batch` (initial view)
3. SHOT-06 `/review/mrs-johnson` (full scroll-through)
4. SHOT-05 `/review/mr-patel` — multiple takes recommended; longest single shot
5. SHOT-04 `/batch` re-visit (separate take for Beat 3.1)
6. SHOT-07 right-pane: Postman or VSCode REST client capture for CDS Hooks
7. SHOT-08, SHOT-09: Prompt Opinion screens (separate browser session)
8. Graphics — assemble in Premiere/Final Cut from Keynote exports

## I. Final pre-take

- [ ] Stopwatch ready — every shot has a target duration in `shot-list.md`
- [ ] `script.md` open on second device or printed
- [ ] Two takes minimum per shot, ideally three
- [ ] After each take, immediately label the file: `SHOT-05-take-2.mp4`

## J. Post-record

- [ ] Backup all raw captures to `demo/assets/raw/` AND a cloud drive (Drive or iCloud) before editing
- [ ] Final cut MUST be under 3:00, ideally 2:30 ± 10s
- [ ] Export: 1920x1080 H.264 MP4, ~50 MB total — fits Devpost/YouTube limits
- [ ] Captions: auto-generate, then hand-edit drug names (TTS gets these wrong)
- [ ] Watch the final at 50% browser zoom — if drug names are unreadable in a Devpost thumbnail crop, increase font sizes in graphics

---

## Quick sanity test (5 minutes before recording)

```bash
# From project root
curl -s http://localhost:3001/ | grep "PolyPharmGuard" && echo "Landing OK"
curl -s http://localhost:3001/api/review/mrs-johnson | jq '.riskScore.interpretation' # expect "CRITICAL" or "HIGH"
curl -s http://localhost:3001/api/review/mr-patel | jq '.riskScore.interpretation'    # expect "CRITICAL"
curl -s -X POST http://localhost:3001/api/cds-hooks \
  -H 'content-type: application/json' \
  -d '{"hook":"medication-prescribe","context":{"patientId":"mr-patel","medications":{"entry":[{"resource":{"medicationCodeableConcept":{"text":"tizanidine 4mg"}}}]}}}' \
  | jq '.cards | length' # expect >= 1
```

If any of these fail, do not record — fix first.
