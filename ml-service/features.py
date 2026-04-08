from dataclasses import dataclass
from typing import Optional

HIGH_RISK_CLASSES = {
    "anticoagulants": ["warfarin", "apixaban", "rivaroxaban", "dabigatran", "enoxaparin"],
    "opioids": ["oxycodone", "morphine", "hydrocodone", "codeine", "fentanyl", "tramadol"],
    "antiarrhythmics": ["amiodarone", "digoxin", "flecainide", "sotalol", "quinidine"],
    "antidiabetics": ["metformin", "glipizide", "glyburide", "insulin", "glargine"],
    "nsaids": ["ibuprofen", "naproxen", "diclofenac", "meloxicam", "ketorolac"],
    "benzodiazepines": ["alprazolam", "diazepam", "lorazepam", "clonazepam", "temazepam"],
}

@dataclass
class PatientFeatures:
    age: float                          # normalized 0-1 (age/100)
    egfr_normalized: float              # normalized 0-1 (egfr/120)
    hepatic_score: float                # 0=normal, 0.5=mild, 1.0=severe
    med_count_normalized: float         # normalized (count/20)
    cyp_interactions: int               # number of CYP450 interactions found
    pd_risk_score: float                # sum of PD risk weights / 20
    beers_count: int                    # number of Beers criteria matches
    has_anticoagulant: float            # 0 or 1
    has_opioid: float                   # 0 or 1
    has_antiarrhythmic: float           # 0 or 1
    lab_gaps: int                       # number of missing/overdue labs


def extract_features(payload: dict) -> list[float]:
    """Extract normalized feature vector from review payload."""
    age = payload.get("age", 65)
    egfr = payload.get("egfr", 90)
    medications = [m.lower() for m in payload.get("medications", [])]
    cyp_interactions = payload.get("cyp_interactions", 0)
    pd_risk_score = payload.get("pd_risk_score", 0)
    beers_count = payload.get("beers_count", 0)
    lab_gaps = payload.get("lab_gaps", 0)
    hepatic_score = payload.get("hepatic_score", 0.0)

    # Check for high-risk drug classes
    has_anticoagulant = float(any(
        any(drug in med for drug in HIGH_RISK_CLASSES["anticoagulants"])
        for med in medications
    ))
    has_opioid = float(any(
        any(drug in med for drug in HIGH_RISK_CLASSES["opioids"])
        for med in medications
    ))
    has_antiarrhythmic = float(any(
        any(drug in med for drug in HIGH_RISK_CLASSES["antiarrhythmics"])
        for med in medications
    ))

    return [
        min(age / 100.0, 1.0),
        1.0 - min(egfr / 120.0, 1.0),   # inverted: low eGFR = high risk
        hepatic_score,
        min(len(medications) / 20.0, 1.0),
        min(cyp_interactions / 10.0, 1.0),
        min(pd_risk_score / 20.0, 1.0),
        min(beers_count / 5.0, 1.0),
        has_anticoagulant,
        has_opioid,
        has_antiarrhythmic,
        min(lab_gaps / 5.0, 1.0),
    ]
