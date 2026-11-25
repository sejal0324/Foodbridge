"""Shared scoring, ranking and explanation machinery for ``weighted-v1`` matching.

This is a deterministic weighted score over criteria in [0, 100], not machine
learning. The backend has already applied every hard eligibility filter; this
module only orders eligible candidates and explains the order.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.schemas.matching import CRITERIA, CriterionResult, MatchResponse, MatchResult, MatchWeights
from app.utils.text import join_phrases

ALGORITHM_VERSION = "weighted-v1"
URGENCY_SCORES: dict[str, float] = {"CRITICAL": 100.0, "HIGH": 75.0, "MEDIUM": 50.0, "LOW": 25.0}
RELIABILITY_MIN_HISTORY = 3
RELIABILITY_NEUTRAL = 70.0
STRENGTH_THRESHOLD = 60.0  # a criterion at or above this can be named as a reason
WEAKNESS_THRESHOLD = 50.0  # the weakest criterion below this is named as a drawback
MAX_REASONS = 3

STRAIGHT_LINE_LIMITATION = "Distance is a straight-line estimate, not road distance."
LIMITED_HISTORY_LIMITATION = (
    "Limited history: fewer than 3 completed or failed collections, so reliability is "
    "scored as neutral (70)."
)


@dataclass(frozen=True)
class Criterion:
    """One criterion's raw score (0-100) and the text used to explain it."""

    score: float
    detail: str
    strength: str | None = None  # phrase completing "<name> ... because it <strength>"
    weakness: str | None = None  # phrase completing "Main drawback: it <weakness>"


@dataclass
class ScoredCandidate:
    candidate_id: str
    name: str
    distance_m: float
    criteria: dict[str, Criterion]
    limitations: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)  # extra sentences appended to the explanation


def clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return max(low, min(high, value))


def distance_score(distance_m: float, radius_m: float) -> float:
    return 100.0 * max(0.0, 1.0 - distance_m / radius_m)


def reliability_criterion(completed: int, failed: int, noun: str) -> tuple[Criterion, str | None]:
    """Reliability criterion and an optional limitation (shared by NGOs and donors)."""
    total = completed + failed
    if total < RELIABILITY_MIN_HISTORY:
        return (
            Criterion(
                score=RELIABILITY_NEUTRAL,
                detail=f"{completed} completed, {failed} failed (limited history, neutral score)",
            ),
            LIMITED_HISTORY_LIMITATION,
        )
    score = 100.0 * completed / total
    return (
        Criterion(
            score=score,
            detail=f"{completed} completed, {failed} failed",
            strength=f"has completed {completed} of {total} past {noun}",
            weakness=f"has completed only {completed} of {total} past {noun}",
        ),
        None,
    )


def total_score(criteria: dict[str, Criterion], weights: dict[str, float]) -> float:
    return round(sum(weights[name] * criteria[name].score / 100.0 for name in CRITERIA), 2)


def explanation(candidate: ScoredCandidate, weights: dict[str, float]) -> str:
    order = {name: i for i, name in enumerate(CRITERIA)}
    strengths = sorted(
        (
            (weights[name] * c.score, order[name], c.strength)
            for name, c in candidate.criteria.items()
            if c.strength and weights[name] > 0 and c.score >= STRENGTH_THRESHOLD
        ),
        key=lambda item: (-item[0], item[1]),
    )
    reasons = [phrase for _, _, phrase in strengths[:MAX_REASONS] if phrase]
    if reasons:
        text = f"{candidate.name} is recommended because it {join_phrases(reasons)}."
    else:
        text = (
            f"{candidate.name} has no single strong factor; its rank reflects the combined "
            "weighted score."
        )

    weaknesses = sorted(
        (
            (c.score, -weights[name], order[name], c.weakness)
            for name, c in candidate.criteria.items()
            if c.weakness and weights[name] > 0 and c.score < WEAKNESS_THRESHOLD
        ),
    )
    if weaknesses:
        text += f" Main drawback: it {weaknesses[0][3]}."
    for note in candidate.notes:
        text += f" {note}"
    return text


def rank(candidates: list[ScoredCandidate], weights: MatchWeights) -> MatchResponse:
    """Score, sort (score desc, distance asc, id asc) and explain."""
    weight_map = weights.as_dict()
    scored = [(total_score(c.criteria, weight_map), c) for c in candidates]
    scored.sort(key=lambda item: (-item[0], item[1].distance_m, item[1].candidate_id))
    results: list[MatchResult] = []
    for position, (score, candidate) in enumerate(scored, start=1):
        criteria = {
            name: CriterionResult(
                score=round(candidate.criteria[name].score, 2),
                weight=weight_map[name],
                contribution=round(weight_map[name] * candidate.criteria[name].score / 100.0, 2),
                detail=candidate.criteria[name].detail,
            )
            for name in CRITERIA
        }
        results.append(
            MatchResult(
                candidate_id=candidate.candidate_id,
                rank=position,
                score=score,
                criteria=criteria,
                explanation=explanation(candidate, weight_map),
                limitations=list(dict.fromkeys(candidate.limitations)),
            )
        )
    return MatchResponse(algorithm_version=ALGORITHM_VERSION, weights=weight_map, results=results)
