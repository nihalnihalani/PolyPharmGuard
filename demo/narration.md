# PolyPharmGuard — Narration (Voiceover Script)

Pure VO copy. No stage directions. Paste directly into ElevenLabs / OpenAI tts-1-hd / human VO booking.
**296 spoken words. At 140 wpm = ~2:07 raw speech. With written-in pauses (~15s of beats), realistic delivery is 2:20–2:30.** Pause durations are advisory; trim or extend in editor.

---

## Voice direction (for human VO)

- Tone: confident, clinical, calm. NOT preachy, NOT salesy.
- Pace: deliberate. Slow down on numbers, speed up on lists.
- Voice profile to match: think *NPR medical correspondent* — warm but factual.
- For TTS: ElevenLabs voice "Adam" (low) or "Rachel" (mid) work well. Stability 50%, similarity 75%.

---

## Section 1 — The Hook  [0:00–0:30]

> Twenty-three alerts.
>
> *(0.5s)*
>
> The doctor ignored every single one. Three of them could have killed her.
>
> *(1.0s)*
>
> Ninety-five percent of EHR drug alerts are overridden. The result: one-point-three million emergency visits a year, thirty billion dollars in preventable harm.
>
> *(0.5s)*
>
> The problem isn't too few alerts. It's that none of them are about *this* patient.
>
> *(0.7s)*
>
> PolyPharmGuard replaces the alert wall with cited clinical reasoning. Three MCP tools, one A2A agent, real FHIR data.

## Section 2 — The AI Reasoning  [0:30–1:50]

> Meet Mr. Patel. Sixty-eight, on fluvoxamine, tizanidine, and clopidogrel. He just finished a Paxlovid course.
>
> Every pairwise checker his pharmacy uses passed him.
>
> *(0.5s, beat for emphasis)*
>
> Ours didn't.
>
> *(1.0s)*
>
> Fluvoxamine is a strong CYP1A2 inhibitor. Tizanidine is metabolized by CYP1A2. The AUC goes up tenfold.
>
> That alone is dangerous. Add residual ritonavir from Paxlovid blocking CYP3A4, plus clopidogrel — a CYP2C19 prodrug now competing for what's left — and you have a synergistic hypotension and bleeding risk that no two-drug rule could see.
>
> *(0.5s)*
>
> Composite risk index. Drug interaction graph. Medication-by-risk-factor matrix. Every red cell links back to a citation.
>
> *(0.7s)*
>
> And Mrs. Johnson, seventy-eight, twelve meds, eGFR twenty-eight. We catch the obvious things too — fluconazole inhibiting CYP3A4 to spike her simvastatin three-fold, with renal impairment amplifying rhabdomyolysis risk.
>
> Plus a four-week taper plan for the PPI she's been on for a decade.

## Section 3 — Distribution + Close  [1:50–2:50]

> Pharmacists triage by risk, not by alphabet. Highest-risk patient first.
>
> *(0.5s)*
>
> Inside the EHR, we ship as standard HL7 CDS Hooks. No custom integration. Every order screen gets cited findings — not generic alerts.
>
> *(0.5s)*
>
> PolyPharmGuard is discoverable, invocable, and billable inside Prompt Opinion. SHARP context flows in. Findings flow back.
>
> *(0.5s)*
>
> Six MCP tools. One A2A orchestrator. SHARP-secured FHIR. Gemini reasoning grounded only on verified knowledge bases — every finding cites its source.
>
> *(1.0s)*
>
> Twenty-three alerts is alert fatigue.
>
> *(0.4s)*
>
> Three cited findings is medicine.
>
> *(0.7s)*
>
> PolyPharmGuard. Reasoning, not warnings.

---

## Pronunciation guide

- **Fluvoxamine** — floo-VOX-a-meen
- **Tizanidine** — ty-ZAN-i-deen
- **Clopidogrel** — kloh-PID-oh-grel
- **Paxlovid** — PAX-loh-vid
- **Fluconazole** — floo-KON-a-zol
- **Simvastatin** — sim-vah-STAT-in
- **Rhabdomyolysis** — RAB-doh-my-OL-y-sis
- **CYP1A2 / CYP3A4 / CYP2C19** — say "sip", not "see-why-pee". So: "sip-one-A-two", "sip-three-A-four", "sip-two-C-nineteen"
- **eGFR** — letter by letter: "ee-G-F-R"
- **MCP / A2A / SHARP / FHIR** — "M-C-P", "A-two-A", "sharp", "fire" (rhymes with "wire")

## Word count

296 spoken words. At 140 wpm baseline that's 2:07 of raw speech. The script's written pauses add ~15s for total realistic delivery of 2:20–2:30. If your VO/TTS is faster (150 wpm), buffer extends.

## QA checklist before recording

- [ ] Read aloud once with a stopwatch — confirm 2:20–2:40
- [ ] Test TTS pronunciation of each drug name — re-spell phonetically if a synthetic voice butchers any
- [ ] No m-dashes — replace with ", " or " — " for natural breath in TTS
- [ ] Numbers spelled out for the most natural reading: "ninety-five percent" not "95%"
