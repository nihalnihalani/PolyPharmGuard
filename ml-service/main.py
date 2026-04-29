"""FastAPI service exposing the PolyPharmGuard composite risk index.

This service deliberately does NOT host a trained ML model. It returns a
transparent additive composite ("composite_heuristic_v1") with the
contributing factors enumerated so that clinicians can audit each weight.
"""

from typing import Any, Optional

from fastapi import FastAPI
from pydantic import BaseModel

from scorer import DISCLAIMER, METHOD_VERSION, compute_risk_score

app = FastAPI(
    title="PolyPharmGuard Composite Risk Index",
    version="1.0.0",
    description=(
        "Transparent additive heuristic risk index for polypharmacy review. "
        "NOT a trained ML model; weights are exposed in every response."
    ),
)


class ScoreRequest(BaseModel):
    age: Optional[int] = 65
    egfr: Optional[float] = 90.0
    egfr_loinc: Optional[str] = "33914-3"
    hepatic_score: Optional[float] = 0.0
    medications: list[str] = []
    cyp_interactions: Optional[int] = 0  # legacy: total count fallback
    cyp_findings: Optional[list[dict[str, Any]]] = None  # preferred: [{severity, finding}]
    pd_risk_score: Optional[float] = 0.0
    beers_count: Optional[int] = 0
    lab_gaps: Optional[int] = 0
    conditions: Optional[list[Any]] = None  # for fall-history detection
    anticoagulant_evidence: Optional[str] = None  # optional override
    # Prodrug activation failure count (e.g. fluvoxamine + clopidogrel; see scorer.py).
    prodrug_failures: Optional[int] = 0
    # Recently-completed mechanism-based CYP inhibitor (Paxlovid/ritonavir within ~5d).
    residual_inhibitor_window: Optional[bool] = False
    # Post-DES/PCI patient on DAPT with concurrent factor compromising efficacy.
    dapt_at_risk: Optional[bool] = False


def _serialize(req: ScoreRequest) -> dict:
    """pydantic v2 model_dump with safe fallback for older runtimes."""
    if hasattr(req, "model_dump"):
        return req.model_dump()
    return req.dict()  # type: ignore[attr-defined]


@app.post("/risk-score")
def risk_score(request: ScoreRequest) -> dict:
    """Primary endpoint: returns score + named factors + disclaimer."""
    return compute_risk_score(_serialize(request))


# Backward-compatible alias for the existing web client which posts to /score.
@app.post("/score")
def score(request: ScoreRequest) -> dict:
    return compute_risk_score(_serialize(request))


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "service": "polypharmguard-risk-index",
        "method": METHOD_VERSION,
        "disclaimer": DISCLAIMER,
    }
