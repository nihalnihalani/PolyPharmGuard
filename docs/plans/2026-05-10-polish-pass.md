# Polish Pass Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Framer Motion micro-interactions and a Claude-flavored visual lift to the three demo screens (`/`, `/batch`, `/review/[id]`) without touching the backend or Cytoscape.

**Architecture:** All work lives in `web/`. A shared variants module (`web/lib/motion.ts`) keeps animation language consistent. The `/review/[id]` server component is split so a thin client wrapper hosts Framer. Tokens (accent color, serif font stack) live in `web/app/globals.css`.

**Tech Stack:** Framer Motion 11.x, Tailwind CSS 4 (already installed), system serif fallback (no webfont network load).

**Verification approach:** This is visual work — TDD doesn't fit. Each task ends with `npm run build` (catches type errors) and a browser walk against the running dev server. Commit after each logical chunk.

---

### Task 1: Install Framer Motion

**Files:**
- Modify: `web/package.json` (via `npm i`)

**Step 1: Install**

```bash
cd web && npm i framer-motion
```

**Step 2: Verify install**

```bash
node -e "console.log(require('framer-motion/package.json').version)"
```

Expected: a version like `11.x` or `12.x` printed.

**Step 3: Commit**

```bash
git add web/package.json web/package-lock.json
git commit -m "chore(web): add framer-motion"
git push origin main
```

---

### Task 2: Shared motion variants

**Files:**
- Create: `web/lib/motion.ts`

**Step 1: Write the module**

```ts
'use client';
import type { Variants, Transition } from 'framer-motion';

export const easeOut: Transition = { duration: 0.35, ease: [0.16, 1, 0.3, 1] };

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: easeOut },
};

export const staggerContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04, delayChildren: 0.05 } },
};

export const cardHover = {
  whileHover: { y: -2, scale: 1.005 },
  whileTap: { scale: 0.98 },
  transition: { type: 'spring', stiffness: 300, damping: 22 } as const,
};

export const criticalPulse = {
  animate: { scale: [1, 1.04, 1] },
  transition: { duration: 2, repeat: Infinity, ease: 'easeInOut' as const },
};
```

**Step 2: Verify build**

```bash
cd web && npm run build 2>&1 | tail -5
```

Expected: clean build, no TS errors.

**Step 3: Commit**

```bash
git add web/lib/motion.ts
git commit -m "feat(web): add shared framer-motion variants"
git push origin main
```

---

### Task 3: Design tokens — accent color + serif stack

**Files:**
- Modify: `web/app/globals.css`

**Step 1: Add tokens**

Append to `globals.css`:

```css
:root {
  --accent-coral: #d97757;
  --accent-coral-soft: #f0b193;
  --font-serif: 'Tiempos Headline', 'Iowan Old Style', Georgia, serif;
}

.font-serif-display {
  font-family: var(--font-serif);
  font-weight: 600;
  letter-spacing: -0.02em;
}

.text-accent {
  color: var(--accent-coral);
}

.bg-accent {
  background-color: var(--accent-coral);
}

.border-accent {
  border-color: var(--accent-coral);
}
```

**Step 2: Verify build**

```bash
cd web && npm run build 2>&1 | tail -3
```

**Step 3: Commit**

```bash
git add web/app/globals.css
git commit -m "feat(web): add Claude-accent tokens and serif stack"
git push origin main
```

---

### Task 4: Landing page polish

**Files:**
- Modify: `web/app/page.tsx`

**Step 1: Apply changes**

- Wrap top-level container in `motion.div` with `fadeUp` initial/animate
- h1 → `font-serif-display`, large
- Primary CTA → `bg-accent text-white` with `cardHover`
- Subtle background gradient via inline style (CSS only, no asset)

(Specific code emerges from reading current `page.tsx`; goal is the visual lift.)

**Step 2: Verify**

```bash
cd web && npm run build 2>&1 | tail -3
```

Open `http://localhost:3001/` in Chrome, confirm:
- Page fades up on load
- Headline is serif
- CTA hovers/taps with motion
- No console errors

**Step 3: Commit**

```bash
git add web/app/page.tsx
git commit -m "feat(web): Claude-flavored landing with fade-up + serif headline"
git push origin main
```

---

### Task 5: Batch queue polish

**Files:**
- Modify: `web/app/batch/page.tsx` (or extract a client child if it's a server component)

**Step 1: Apply changes**

- Page-level fade-up via `motion.div`
- Patient cards: wrap each in `motion.div` with `cardHover`
- Score badges: count-up animation using `motion`'s `useMotionValue` + `useTransform` (or a small client component `<AnimatedScore value={n} />`)
- Mr. Patel row: `border-accent border-l-2` to lead the eye for the demo
- Stagger the two cards on mount

**Step 2: Verify**

```bash
cd web && npm run build 2>&1 | tail -3
```

Open `http://localhost:3001/batch`, confirm:
- Page fades up
- Score badges count up from 0 to 85 on mount
- Hover lift on each row
- Mr. Patel row has accent left border
- No console errors

**Step 3: Commit**

```bash
git add web/app/batch/page.tsx web/components/AnimatedScore.tsx
git commit -m "feat(web): batch queue with hover-lift cards and count-up score badges"
git push origin main
```

---

### Task 6: Review page — client wrapper + page fade-up

**Files:**
- Create: `web/app/review/[patientId]/ReviewPageClient.tsx`
- Modify: `web/app/review/[patientId]/page.tsx`

**Step 1: Extract client wrapper**

Move the JSX body from `page.tsx` into `ReviewPageClient.tsx` (mark `'use client'`).
`page.tsx` keeps the data fetch and renders `<ReviewPageClient {...props} />`.
Wrap the client root in `motion.div initial="hidden" animate="show" variants={fadeUp}`.

**Step 2: Verify**

```bash
cd web && npm run build 2>&1 | tail -3
```

Open `http://localhost:3001/review/mr-patel`, confirm page fades in, all data still renders, no console errors.

**Step 3: Commit**

```bash
git add web/app/review/[patientId]/page.tsx web/app/review/[patientId]/ReviewPageClient.tsx
git commit -m "feat(web): split /review into server fetch + animated client wrapper"
git push origin main
```

---

### Task 7: Risk gauge count-up

**Files:**
- Modify: `web/components/RiskScoreGauge.tsx`

**Step 1: Wire up motion value for the score number**

Use `useMotionValue` initialized to 0; on mount, animate to `score` over 800ms; render the rounded value via `useTransform` + `motion.span`.

**Step 2: Verify**

Open Mr. Patel review, confirm the gauge number ticks from 0 → 85 on page load. No layout shift. No console errors.

**Step 3: Commit**

```bash
git add web/components/RiskScoreGauge.tsx
git commit -m "feat(web): risk gauge score counts up on mount"
git push origin main
```

---

### Task 8: Findings list stagger + critical pulse

**Files:**
- Modify: `web/app/review/[patientId]/ReviewPageClient.tsx`

**Step 1: Apply stagger**

Wrap the findings `<div className="space-y-2">` in `motion.div variants={staggerContainer} initial="hidden" animate="show"`.
Wrap each finding card in `motion.div variants={fadeUp}`.

**Step 2: Apply critical pulse**

Inside `EvidenceChainAccordion` (or by passing a className via props), add the `criticalPulse` animation to the severity badge when `severity === 'CRITICAL'`. If touching that component is risky, instead wrap the severity tag in a `<motion.span>` from the parent finding card.

**Step 3: Verify**

```bash
cd web && npm run build 2>&1 | tail -3
```

Open Mr. Patel review, confirm findings cascade in with a small stagger, CRITICAL badges have a subtle pulse. No console errors.

**Step 4: Commit**

```bash
git add web/app/review/[patientId]/ReviewPageClient.tsx web/components/EvidenceChainAccordion.tsx
git commit -m "feat(web): stagger findings list + pulse CRITICAL severity badges"
git push origin main
```

---

### Task 9: Final cross-page sanity walk

**Step 1: Boot fresh**

```bash
./run.sh --stop
./run.sh --no-tail
```

Wait for all-green health.

**Step 2: Walk in Chrome**

For each of `/`, `/batch`, `/review/mr-patel`, `/review/mrs-johnson`:
- Page loads without console errors
- Animations fire on mount
- Hover/tap interactions feel right
- Existing data (cascade chains, risk score, graph) still renders correctly

**Step 3: Verify tests still pass**

```bash
cd /Users/nihalnihalani/Desktop/Github/PolyPharmGuard && npm test 2>&1 | tail -6
```

Expected: 90/90 passing.

**Step 4: Commit any final tweaks**

```bash
git add -A
git status   # should be clean OR small last-mile fixes only
```

If there are last-mile tweaks, commit them; otherwise nothing to do.

---

## Done condition

- All 9 tasks committed and pushed
- `npm test` 90/90
- `npm run build` clean (root + web)
- Demo URL walk in Chrome shows animations on `/`, `/batch`, `/review/[id]` with zero console errors
- Cytoscape graph, risk gauge data, cascade findings all still render correctly
