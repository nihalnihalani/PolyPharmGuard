from fastapi import FastAPI
from pydantic import BaseModel
from typing import Optional
from scorer import score_patient

app = FastAPI(title="PolyPharmGuard ML Risk Scorer", version="1.0.0")


class ScoreRequest(BaseModel):
    age: Optional[int] = 65
    egfr: Optional[float] = 90.0
    hepatic_score: Optional[float] = 0.0
    medications: list[str] = []
    cyp_interactions: Optional[int] = 0
    pd_risk_score: Optional[float] = 0.0
    beers_count: Optional[int] = 0
    lab_gaps: Optional[int] = 0


@app.post("/score")
def score(request: ScoreRequest) -> dict:
    return score_patient(request.model_dump())


@app.get("/health")
def health():
    return {"status": "ok", "service": "polypharmguard-ml-scorer"}
