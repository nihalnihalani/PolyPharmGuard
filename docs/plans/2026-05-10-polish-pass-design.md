# Polish Pass — Framer Motion + Claude-flavored Design

**Date:** 2026-05-10
**Scope:** Web app only (`web/`)
**Driver:** Demo recording for Agents Assemble hackathon (deadline 2026-05-11)
**Approved by user:** yes (focused polish-pass option, ~2-3 hrs)

## Goal

Lift the visual quality of the three demo screens (`/`, `/batch`, `/review/[id]`)
to make the demo video read as polished and intentional, without rebranding the
clinical-data screens or risking regressions on the day of the deadline.

## Aesthetic direction

Keep the dark base — the clinical data needs the contrast — but warm it from
cool slate to a darker bronze/coffee. Add a single coral/orange accent
(`#d97757`) used sparingly for the risk gauge, severity badges on CRITICAL
findings, and primary CTAs. Headings get a serif display fallback chain
(`'Tiempos Headline', 'Iowan Old Style', Georgia, serif`) to evoke the Claude
brand without loading a webfont. Card radius lifts from `rounded-xl` to
`rounded-2xl`; flat borders are replaced or supplemented with soft drop shadows.

## Animation taxonomy

| Pattern | Where | Detail |
|---|---|---|
| Page enter | `/review/*`, `/batch`, `/` body | Opacity 0→1, y +8→0, 350ms ease-out |
| Card hover | Patient cards, finding cards, risk gauge | `whileHover={{ y: -2, scale: 1.005 }}` |
| Score count-up | Risk gauge number | `useMotionValue` + `useTransform`, 0→score over 800ms |
| Stagger reveal | Findings list | `staggerChildren: 0.04`, child fade+slide |
| Severity pulse | CRITICAL badges | 2s `[1, 1.04, 1]` scale loop, infinite |
| Tap feedback | Primary buttons | `whileTap={{ scale: 0.97 }}` |

All variants live in a single `web/lib/motion.ts` module so consumers reuse
named variants (`fadeUp`, `staggerContainer`, `cardHover`) instead of
hand-rolling props. This keeps the interaction language consistent across
pages.

## Per-page changes

### `/` landing
- Serif h1 with animated tagline reveal (split text or simple fade-up)
- Coral CTA button with hover lift + tap shrink
- Subtle background gradient or noise (CSS only, no asset)

### `/batch` queue
- Warmer card background (`bg-stone-900` ish over current `bg-gray-900`)
- Patient row: hover lift, animated score badge that counts up on mount
- Mr. Patel row gets a subtle 1px accent border (visual lead for demo)
- Page-level fade-up on load

### `/review/[id]` review
- Wrap server-rendered content in a thin client component
  (`ReviewPageClient.tsx`) so Framer Motion can run
- Page fade-up
- Risk gauge count-up animation
- Findings list staggers in
- Header serif treatment, accent on patient name
- Risk matrix cells: gentle hover highlight (not animated, just CSS)
- Cytoscape graph untouched (canvas-rendered, no Framer hook)

## Tech additions

- `npm i framer-motion` in `web/`
- New: `web/lib/motion.ts` — shared variants
- Edits to `web/app/globals.css` — accent token, serif font stack, optional
  background gradient utility
- New: `web/app/review/[patientId]/ReviewPageClient.tsx` — thin client wrapper
  around the existing server component's body

## Out of scope

- Cytoscape graph (canvas, no Framer interop)
- Cascade chain content, clinical text wording, scorer logic
- ML service, MCP server, A2A agent — backend untouched
- `/comparison`, `/patient-summary/[id]`, `/cases/mr-patel` static pages
  (won't appear in the 3-min demo; deferred)
- Webfont loading (use system serif fallback)

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Framer Motion bundle size (~60kb gzipped) | Acceptable for internal demo; Next 16 tree-shakes unused exports |
| Server component → client component refactor for `/review` | Keep it minimal: one thin wrapper, server still does the data fetch |
| New accent color clashing with severity reds | Reserve coral `#d97757` for non-severity UI only (CTAs, gauges, headings); keep severity scale (red/orange/yellow/gray) untouched |
| Animations look gimmicky on a clinical product | Bias toward subtle (≤350ms, small displacement). The product needs to feel calm, not playful |

## Verification before completion

- `npm run build` in `web/` — zero TypeScript errors
- Boot via `./run.sh --no-tail` and walk all three demo pages in Chrome
- Confirm no console errors on any of `/`, `/batch`, `/review/mr-patel`,
  `/review/mrs-johnson`
- Confirm Mr. Patel review page still renders the cascade chain, risk gauge,
  graph, and findings exactly as before — animations should overlay, not
  replace, existing content
