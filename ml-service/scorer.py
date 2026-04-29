"""Composite Risk Index for polypharmacy adverse-event risk.

This module is intentionally NOT a machine-learning model. It is a transparent,
additive heuristic that sums clinically defensible weights derived from
published geriatric pharmacotherapy guidance (Beers Criteria 2023, STOPPFrail,
KDIGO CKD staging, AGS anticholinergic burden literature). The weights are
exposed in the API response so a clinician can audit every contributing factor.

It is explicitly NOT a validated clinical risk model and must not be used to
override clinician judgment. See the disclaimer returned with every score.
"""

from __future__ import annotations

from typing import Any

from features import HIGH_RISK_CLASSES, extract_features

# ---------------------------------------------------------------------------
# Heuristic weights (composite_heuristic_v1)
#
# Each weight is bounded; categories that can fire repeatedly (e.g. Beers hits,
# missed labs) are capped so a single category cannot dominate the score.
# ---------------------------------------------------------------------------
WEIGHT_ANTICOAGULANT = 15
WEIGHT_EGFR_LT_30 = 20
WEIGHT_EGFR_30_59 = 10
WEIGHT_AGE_GE_80 = 10
WEIGHT_BEERS_PER_HIT = 5
WEIGHT_BEERS_CAP = 20
WEIGHT_CYP_HIGH_PER_HIT = 15
WEIGHT_CYP_MEDIUM_PER_HIT = 8
WEIGHT_CYP_CAP = 30  # don't let a single tool's findings exceed this
WEIGHT_LAB_GAP_PER_HIT = 5
WEIGHT_LAB_GAP_CAP = 15
WEIGHT_ANTICHOLINERGIC_BURDEN = 10
WEIGHT_FALL_HISTORY = 10

SCORE_MAX = 100

METHOD_VERSION = "composite_heuristic_v1"
DISCLAIMER = (
    "Heuristic composite; not a validated clinical risk model. "
    "For research/demo use."
)

# Anticholinergic Cognitive Burden (ACB) - high-burden drugs (score >=2 on ACB scale).
# Subset chosen from AGS Beers Criteria 2023 high-anticholinergic table.
HIGH_ANTICHOLINERGIC_DRUGS = {
    "diphenhydramine",
    "hydroxyzine",
    "amitriptyline",
    "nortriptyline",
    "doxepin",
    "imipramine",
    "paroxetine",
    "oxybutynin",
    "tolterodine",
    "solifenacin",
    "trospium",
    "darifenacin",
    "fesoterodine",
    "cyclobenzaprine",
    "promethazine",
    "chlorpheniramine",
    "meclizine",
    "scopolamine",
    "benztropine",
    "trihexyphenidyl",
    "dicyclomine",
    "hyoscyamine",
}

# SNOMED-ish keyword fragments that indicate a recent fall history when scanning
# a patient's conditions list. We accept either SNOMED display strings or
# free-text condition labels.
FALL_HISTORY_KEYWORDS = (
    "fall",
    "falling",
    "syncope",
    "fall risk",
    "history of falls",
)


def _band(score: int) -> str:
    if score >= 75:
        return "Critical"
    if score >= 50:
        return "High"
    if score >= 25:
        return "Moderate"
    return "Low"


def _interpretation(score: int) -> str:
    """Backward-compatible CAPS label used by the web UI."""
    if score >= 75:
        return "CRITICAL"
    if score >= 50:
        return "HIGH"
    if score >= 25:
        return "MODERATE"
    return "LOW"


def _find_anticoagulant(medications: list[str]) -> str | None:
    for med in medications:
        for drug in HIGH_RISK_CLASSES["anticoagulants"]:
            if drug in med.lower():
                return drug
    return None


def _count_anticholinergics(medications: list[str]) -> list[str]:
    hits: list[str] = []
    for med in medications:
        med_lower = med.lower()
        for drug in HIGH_ANTICHOLINERGIC_DRUGS:
            if drug in med_lower:
                hits.append(drug)
                break
    return hits


def _has_fall_history(conditions: list[Any]) -> str | None:
    """Return the matching condition string if fall history is present."""
    for cond in conditions or []:
        if isinstance(cond, str):
            label = cond.lower()
        elif isinstance(cond, dict):
            label = " ".join(
                str(v) for v in (cond.get("display"), cond.get("text"), cond.get("code"))
                if v
            ).lower()
        else:
            continue
        for kw in FALL_HISTORY_KEYWORDS:
            if kw in label:
                return label.strip()
    return None


def compute_risk_score(payload: dict) -> dict:
    """Compute a transparent additive composite risk index.

    The payload is the same dict the web API sends to /score. Optional keys
    used for richer evidence reporting:
      - egfr_loinc: LOINC code string for the eGFR observation (default 33914-3)
      - cyp_findings: list of {severity, finding} from the cascade tool. If
        absent, falls back to the legacy ``cyp_interactions`` integer count
        treated as MEDIUM-severity findings.
      - conditions: list of condition strings or dicts for fall-history scan.
      - anticoagulant_evidence: optional override for evidence string.
    """
    factors: list[dict[str, Any]] = []

    age = int(payload.get("age", 65) or 65)
    egfr = float(payload.get("egfr", 90) or 90)
    medications = [m for m in (payload.get("medications") or []) if isinstance(m, str)]
    beers_count = int(payload.get("beers_count", 0) or 0)
    lab_gaps = int(payload.get("lab_gaps", 0) or 0)
    conditions = payload.get("conditions") or []
    egfr_loinc = payload.get("egfr_loinc", "33914-3")

    # --- Renal (eGFR) ----------------------------------------------------
    if egfr < 30:
        factors.append(
            {
                "name": "eGFR < 30 (CKD stage 4-5)",
                "weight": WEIGHT_EGFR_LT_30,
                "evidence": f"Observation {egfr_loinc} = {egfr:g} mL/min/1.73m^2",
                "category": "renal",
            }
        )
    elif egfr < 60:
        factors.append(
            {
                "name": "eGFR 30-59 (CKD stage 3)",
                "weight": WEIGHT_EGFR_30_59,
                "evidence": f"Observation {egfr_loinc} = {egfr:g} mL/min/1.73m^2",
                "category": "renal",
            }
        )

    # --- Age -------------------------------------------------------------
    if age >= 80:
        factors.append(
            {
                "name": "Age >= 80",
                "weight": WEIGHT_AGE_GE_80,
                "evidence": f"Patient age = {age}",
                "category": "demographic",
            }
        )

    # --- Anticoagulant ---------------------------------------------------
    anticoag = _find_anticoagulant(medications)
    if anticoag is not None:
        evidence = payload.get("anticoagulant_evidence") or f"{anticoag} present in medication list"
        factors.append(
            {
                "name": "Anticoagulant present",
                "weight": WEIGHT_ANTICOAGULANT,
                "evidence": evidence,
                "category": "high_risk_drug_class",
            }
        )

    # --- Beers Criteria hits (capped) ------------------------------------
    if beers_count > 0:
        beers_weight = min(beers_count * WEIGHT_BEERS_PER_HIT, WEIGHT_BEERS_CAP)
        factors.append(
            {
                "name": f"Beers Criteria hit{'s' if beers_count != 1 else ''} ({beers_count})",
                "weight": beers_weight,
                "evidence": f"AGS Beers Criteria 2023 - {beers_count} flagged medication(s)",
                "category": "deprescribing",
            }
        )

    # --- CYP cascade findings (HIGH and MEDIUM) --------------------------
    cyp_findings = payload.get("cyp_findings")
    cyp_high = 0
    cyp_medium = 0
    if isinstance(cyp_findings, list) and cyp_findings:
        for f in cyp_findings:
            sev = str(f.get("severity", "")).upper() if isinstance(f, dict) else ""
            if sev in ("CRITICAL", "HIGH"):
                cyp_high += 1
            elif sev in ("MEDIUM", "MODERATE"):
                cyp_medium += 1
    else:
        # Legacy fallback: payload.cyp_interactions is just an integer count.
        # Treat them all as MEDIUM-severity to remain conservative.
        cyp_medium = int(payload.get("cyp_interactions", 0) or 0)

    cyp_total = cyp_high * WEIGHT_CYP_HIGH_PER_HIT + cyp_medium * WEIGHT_CYP_MEDIUM_PER_HIT
    cyp_total = min(cyp_total, WEIGHT_CYP_CAP)
    if cyp_high > 0:
        factors.append(
            {
                "name": f"Active CYP cascade finding (HIGH) x{cyp_high}",
                "weight": min(cyp_high * WEIGHT_CYP_HIGH_PER_HIT, WEIGHT_CYP_CAP),
                "evidence": "analyze_cascade_interactions tool - HIGH/CRITICAL severity",
                "category": "pharmacokinetic",
            }
        )
    if cyp_medium > 0 and cyp_total > min(cyp_high * WEIGHT_CYP_HIGH_PER_HIT, WEIGHT_CYP_CAP):
        # Only attribute medium weight if cap left room after high-severity hits
        remaining = WEIGHT_CYP_CAP - min(cyp_high * WEIGHT_CYP_HIGH_PER_HIT, WEIGHT_CYP_CAP)
        med_weight = min(cyp_medium * WEIGHT_CYP_MEDIUM_PER_HIT, remaining)
        if med_weight > 0:
            factors.append(
                {
                    "name": f"Active CYP cascade finding (MEDIUM) x{cyp_medium}",
                    "weight": med_weight,
                    "evidence": "analyze_cascade_interactions tool - MEDIUM severity",
                    "category": "pharmacokinetic",
                }
            )

    # --- Lab monitoring gaps (capped) ------------------------------------
    if lab_gaps > 0:
        lab_weight = min(lab_gaps * WEIGHT_LAB_GAP_PER_HIT, WEIGHT_LAB_GAP_CAP)
        factors.append(
            {
                "name": f"Missing/overdue lab monitoring ({lab_gaps})",
                "weight": lab_weight,
                "evidence": f"check_lab_monitoring tool - {lab_gaps} gap(s)",
                "category": "monitoring",
            }
        )

    # --- High anticholinergic burden -------------------------------------
    anticholinergics = _count_anticholinergics(medications)
    if len(anticholinergics) >= 3:
        factors.append(
            {
                "name": f"High anticholinergic burden ({len(anticholinergics)} drugs)",
                "weight": WEIGHT_ANTICHOLINERGIC_BURDEN,
                "evidence": "ACB-scale drugs: " + ", ".join(sorted(set(anticholinergics))),
                "category": "anticholinergic",
            }
        )

    # --- Fall history ----------------------------------------------------
    fall_match = _has_fall_history(conditions)
    if fall_match:
        factors.append(
            {
                "name": "Recent fall history",
                "weight": WEIGHT_FALL_HISTORY,
                "evidence": f"Condition: {fall_match[:80]}",
                "category": "history",
            }
        )

    # --- Aggregate -------------------------------------------------------
    raw_score = sum(int(f["weight"]) for f in factors)
    score = min(raw_score, SCORE_MAX)
    capped = raw_score > SCORE_MAX

    return {
        "score": score,
        "rawScore": raw_score,
        "capped": capped,
        "band": _band(score),
        "interpretation": _interpretation(score),  # backward compat for UI
        # Backward-compatible field used by existing UI/PDF text ("X% probability...").
        # We label this as a normalized index, NOT an estimated probability.
        "probability90Day": round(score / 100.0, 3),
        "factors": factors,
        "method": METHOD_VERSION,
        "disclaimer": DISCLAIMER,
    }


# Backward-compatible alias used by main.py and any tests.
def score_patient(payload: dict) -> dict:
    return compute_risk_score(payload)


__all__ = [
    "compute_risk_score",
    "score_patient",
    "extract_features",  # re-exported for convenience
    "METHOD_VERSION",
    "DISCLAIMER",
]
