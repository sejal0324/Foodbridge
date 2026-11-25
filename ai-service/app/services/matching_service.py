"""``weighted-v1`` candidate scoring for both matching directions.

* ``match_ngos``: rank NGOs for a donation.
* ``match_donors``: rank donors for an NGO assistance request.

Formulas are documented in docs/MATCHING_ALGORITHM.md and must stay in step
with it. Every criterion is in [0, 100]; the score is the weighted sum / 100.
"""

from __future__ import annotations

from app.schemas.matching import (
    DonationSubject,
    DonorCandidate,
    MatchDonorsRequest,
    MatchNgosRequest,
    MatchResponse,
    NgoCandidate,
)
from app.services.matching_common import (
    STRAIGHT_LINE_LIMITATION,
    URGENCY_SCORES,
    Criterion,
    ScoredCandidate,
    clamp,
    distance_score,
    rank,
    reliability_criterion,
)
from app.utils.text import DISTANCE_SOURCE_LABELS, fmt_distance, fmt_number, unit_word

URBAN_SPEED_KMH = 20.0
SLACK_FULL_MIN = 120.0  # slack at or above this scores 100
SLACK_ZERO_MIN = 15.0  # slack at or below this scores 0
COLD_STORAGE = {"REFRIGERATED", "FROZEN"}
BENEFICIARY_REFERENCE = 200.0

ESTIMATED_TRAVEL_LIMITATION = (
    "Travel time is estimated at 20 km/h urban average, not taken from road data."
)
CAPACITY_UNKNOWN_LIMITATION = "NGO capacity unknown: quantity fit is scored as neutral (50)."
NO_REFRIGERATION_LIMITATION = "NGO has no refrigeration, but this food must be kept cold."
BENEFICIARIES_UNKNOWN_LIMITATION = "Beneficiary count not reported: scored as 0."
NO_QUANTITY_EVIDENCE_LIMITATION = (
    "No quantity evidence: the donor has no available matching food, forecast or surplus history."
)
ESTIMATED_QUANTITY_LIMITATION = (
    "Quantity is a forecast/historical estimate — the donor must confirm actual food."
)
DIET_UNCONFIRMED_LIMITATION = (
    "Dietary compatibility unconfirmed: the donor has no listed food matching the requirement yet."
)
AVAILABILITY_UNKNOWN_LIMITATION = (
    "Donor availability not configured: pickup availability is scored as neutral (50)."
)
ESTIMATE_NOTE = (
    "No food is confirmed yet: quantities shown are estimates, and the donor must confirm actual "
    "food before anything is reserved."
)


def _distance(distance_m: float, radius_m: float, source: str, limitations: list[str]) -> Criterion:
    source_label = DISTANCE_SOURCE_LABELS[source]
    if source == "STRAIGHT_LINE_ESTIMATE":
        limitations.append(STRAIGHT_LINE_LIMITATION)
    within = distance_m <= radius_m
    return Criterion(
        score=distance_score(distance_m, radius_m),
        detail=f"{fmt_distance(distance_m)} ({source_label}) of {fmt_distance(radius_m)} radius",
        strength=f"is {fmt_distance(distance_m)} away ({source_label})",
        weakness=(
            f"is {fmt_distance(distance_m)} away, near the edge of the "
            f"{fmt_distance(radius_m)} radius"
            if within
            else f"is {fmt_distance(distance_m)} away, beyond the {fmt_distance(radius_m)} radius"
        ),
    )


# --------------------------------------------------------------------------- donation -> NGOs


def _ngo_food_requirement(donation: DonationSubject, ngo: NgoCandidate) -> Criterion:
    need = ngo.open_need
    if need is None:
        return Criterion(score=60.0, detail="No open request; the NGO accepts this food type")
    diet = "vegetarian " if need.dietary_requirement.value == "VEG_ONLY" else ""
    qty = need.quantity_remaining
    words = unit_word(donation.unit.value, qty)
    return Criterion(
        score=100.0,
        detail=f"Open request for {qty} {diet}{words} (urgency {need.urgency.value})",
        strength=f"needs {qty} {diet}{words} (urgency {need.urgency.value})",
    )


def _ngo_quantity(
    donation: DonationSubject, ngo: NgoCandidate, limitations: list[str]
) -> Criterion:
    offered = donation.quantity_available
    words = unit_word(donation.unit.value, offered)
    if ngo.capacity_remaining is None:
        limitations.append(CAPACITY_UNKNOWN_LIMITATION)
        return Criterion(score=50.0, detail="Capacity unknown (neutral score)")
    capacity = ngo.capacity_remaining
    score = 100.0 * min(1.0, capacity / offered)
    return Criterion(
        score=score,
        detail=f"Capacity {capacity} for {offered} {words} offered",
        strength=(
            "can take the full quantity"
            if capacity >= offered
            else f"can take {capacity} of the {offered} {words}"
        ),
        weakness=f"has capacity for only {capacity} of the {offered} {words}",
    )


def _ngo_handling(
    donation: DonationSubject, ngo: NgoCandidate, limitations: list[str]
) -> Criterion:
    storage = donation.storage_type.value
    needs_cold = donation.requires_refrigeration or storage in COLD_STORAGE
    if not needs_cold:
        return Criterion(score=100.0, detail=f"No cold-chain requirement ({storage})")
    if ngo.has_refrigeration:
        return Criterion(
            score=100.0,
            detail=f"Food must be kept cold ({storage}); NGO has refrigeration",
            strength="has refrigeration for food that must be kept cold",
        )
    limitations.append(NO_REFRIGERATION_LIMITATION)
    return Criterion(
        score=40.0,
        detail=f"Food must be kept cold ({storage}); NGO has no refrigeration",
        weakness="has no refrigeration for food that must be kept cold",
    )


def _ngo_urgency(ngo: NgoCandidate) -> Criterion:
    if ngo.open_need is None:
        return Criterion(score=10.0, detail="No open request (lowest urgency score)")
    urgency = ngo.open_need.urgency.value
    # Named together with the open need in the food_requirement phrase.
    return Criterion(score=URGENCY_SCORES[urgency], detail=f"Open request urgency {urgency}")


def _ngo_pickup(donation: DonationSubject, ngo: NgoCandidate, limitations: list[str]) -> Criterion:
    if ngo.travel_time_s is not None:
        travel_min = ngo.travel_time_s / 60.0
        travel_label = "travel time provided"
    else:
        travel_min = ngo.distance_m / (URBAN_SPEED_KMH * 1000.0 / 60.0)
        travel_label = "estimated at 20 km/h urban average"
        limitations.append(ESTIMATED_TRAVEL_LIMITATION)
    slack = donation.minutes_until_deadline - travel_min
    score = clamp(100.0 * (slack - SLACK_ZERO_MIN) / (SLACK_FULL_MIN - SLACK_ZERO_MIN))
    return Criterion(
        score=score,
        detail=(
            f"~{fmt_number(travel_min)} min travel ({travel_label}); "
            f"{fmt_number(slack)} min to spare before the deadline"
        ),
        strength=(
            "can collect well before the deadline"
            if score >= 100.0
            else "can collect before the deadline"
        ),
        weakness=f"would have only about {fmt_number(max(slack, 0.0))} min to spare before the "
        "deadline",
    )


def _ngo_beneficiaries(
    ngo: NgoCandidate, max_beneficiaries: int, limitations: list[str]
) -> Criterion:
    if ngo.beneficiaries_count is None:
        limitations.append(BENEFICIARIES_UNKNOWN_LIMITATION)
    count = ngo.beneficiaries_count or 0
    score = 100.0 * count / max_beneficiaries if max_beneficiaries > 0 else 0.0
    return Criterion(
        score=score,
        detail=f"{count} beneficiaries (largest among candidates: {max_beneficiaries})",
        strength=f"serves {count} beneficiaries" if count > 0 else None,
    )


def match_ngos(request: MatchNgosRequest) -> MatchResponse:
    donation = request.donation
    max_beneficiaries = max((c.beneficiaries_count or 0 for c in request.candidates), default=0)
    scored: list[ScoredCandidate] = []
    for ngo in request.candidates:
        limitations: list[str] = []
        reliability, reliability_note = reliability_criterion(
            ngo.reliability.completed, ngo.reliability.failed, "collections"
        )
        criteria = {
            "distance": _distance(
                ngo.distance_m, ngo.collection_radius_m, ngo.distance_source.value, limitations
            ),
            "food_requirement": _ngo_food_requirement(donation, ngo),
            "quantity_capacity": _ngo_quantity(donation, ngo, limitations),
            "food_preference": _ngo_handling(donation, ngo, limitations),
            "urgency": _ngo_urgency(ngo),
            "pickup_availability": _ngo_pickup(donation, ngo, limitations),
            "reliability": reliability,
            "beneficiary_demand": _ngo_beneficiaries(ngo, max_beneficiaries, limitations),
        }
        if reliability_note:
            limitations.append(reliability_note)
        scored.append(
            ScoredCandidate(
                candidate_id=ngo.ngo_id,
                name=ngo.name,
                distance_m=ngo.distance_m,
                criteria=criteria,
                limitations=limitations,
            )
        )
    return rank(scored, request.weights)


# --------------------------------------------------------------------------- request -> donors


def _donor_food_requirement(donor: DonorCandidate, unit: str) -> Criterion:
    if donor.available_matching_quantity > 0:
        qty = donor.available_matching_quantity
        return Criterion(
            score=100.0,
            detail=f"{qty} matching {unit_word(unit, qty)} available now",
            strength=f"has {qty} matching {unit_word(unit, qty)} available now",
        )
    if donor.produces_category:
        return Criterion(
            score=70.0,
            detail="Produces this food category; nothing listed right now",
            strength="regularly produces this food category",
        )
    return Criterion(
        score=40.0,
        detail="Has not listed this food category",
        weakness="has not listed this food category",
    )


def _donor_quantity(
    donor: DonorCandidate, needed: int, unit: str, limitations: list[str]
) -> tuple[Criterion, bool]:
    """Quantity criterion and whether it rests on an estimate (forecast/history)."""
    available = float(donor.available_matching_quantity)
    predicted = donor.predicted_surplus or 0.0
    historical = donor.historical_avg_surplus or 0.0
    expected = max(available, predicted, historical)
    if expected <= 0:
        limitations.append(NO_QUANTITY_EVIDENCE_LIMITATION)
        return (
            Criterion(
                score=0.0,
                detail="No available food, forecast or surplus history",
                weakness="has no quantity evidence (no available food, forecast or history)",
            ),
            False,
        )
    score = 100.0 * min(1.0, expected / needed)
    words = unit_word(unit, needed)
    expected_text = fmt_number(expected)
    if available >= expected:
        detail = f"{expected_text} {words} available now for {needed} needed"
        strength = (
            "can cover the full request with food available now"
            if available >= needed
            else f"has {expected_text} of the {needed} {words} needed available now"
        )
        estimated = False
    else:
        limitations.append(ESTIMATED_QUANTITY_LIMITATION)
        estimated = True
        if predicted >= historical:
            detail = f"Forecast surplus ~{expected_text} {words} (estimate) for {needed} needed"
            strength = (
                f"is forecast to have about {expected_text} {words} of surplus "
                "(an estimate, not confirmed food)"
            )
        else:
            detail = (
                f"Historical average surplus ~{expected_text} {words} (estimate) "
                f"for {needed} needed"
            )
            strength = (
                f"has historically averaged about {expected_text} {words} of surplus "
                "(an estimate, not confirmed food)"
            )
    weakness = f"is expected to cover only about {expected_text} of the {needed} {words} needed"
    if estimated:
        weakness += " (an estimate, not confirmed food)"
    return (
        Criterion(score=score, detail=detail, strength=strength, weakness=weakness),
        estimated,
    )


def _donor_diet(donor: DonorCandidate, limitations: list[str]) -> Criterion:
    if donor.available_matching_quantity > 0:
        return Criterion(
            score=100.0, detail="Listed food is compatible with the dietary requirement"
        )
    limitations.append(DIET_UNCONFIRMED_LIMITATION)
    return Criterion(score=60.0, detail="Dietary compatibility unconfirmed (no listed food)")


def _donor_pickup(donor: DonorCandidate, limitations: list[str]) -> Criterion:
    window = donor.needed_window_minutes
    overlap = donor.availability_overlap_minutes
    if overlap is None:
        limitations.append(AVAILABILITY_UNKNOWN_LIMITATION)
        return Criterion(score=50.0, detail="Donor availability not configured (neutral score)")
    score = 100.0 * min(1.0, overlap / window)
    of_window = f"{fmt_number(overlap)} of the {fmt_number(window)} minutes needed"
    return Criterion(
        score=score,
        detail=f"Available {fmt_number(overlap)} of {fmt_number(window)} needed minutes",
        strength=(
            "is available for the whole needed window"
            if overlap >= window
            else f"is available for {of_window}"
        ),
        weakness=f"is available for only {of_window}",
    )


def match_donors(request: MatchDonorsRequest) -> MatchResponse:
    need = request.request
    unit = need.unit.value
    urgency_score = URGENCY_SCORES[need.urgency.value]
    beneficiary_score = 100.0 * min(1.0, need.beneficiaries_count / BENEFICIARY_REFERENCE)
    scored: list[ScoredCandidate] = []
    for donor in request.candidates:
        limitations: list[str] = []
        quantity, estimated = _donor_quantity(donor, need.quantity_remaining, unit, limitations)
        reliability, reliability_note = reliability_criterion(
            donor.reliability.completed, donor.reliability.failed, "donations"
        )
        criteria = {
            "distance": _distance(
                donor.distance_m, donor.max_radius_m, donor.distance_source.value, limitations
            ),
            "food_requirement": _donor_food_requirement(donor, unit),
            "quantity_capacity": quantity,
            "food_preference": _donor_diet(donor, limitations),
            "urgency": Criterion(
                score=urgency_score, detail=f"Request urgency {need.urgency.value}"
            ),
            "pickup_availability": _donor_pickup(donor, limitations),
            "reliability": reliability,
            "beneficiary_demand": Criterion(
                score=beneficiary_score,
                detail=f"Request serves {need.beneficiaries_count} beneficiaries (reference 200)",
            ),
        }
        if reliability_note:
            limitations.append(reliability_note)
        notes: list[str] = []
        if donor.available_matching_quantity == 0:
            notes.append(ESTIMATE_NOTE)
        elif estimated:
            confirmed = donor.available_matching_quantity
            notes.append(
                f"Only {confirmed} {unit_word(unit, confirmed)} are listed now; the rest of the "
                "expected quantity is an estimate the donor must confirm."
            )
        scored.append(
            ScoredCandidate(
                candidate_id=donor.donor_id,
                name=donor.name,
                distance_m=donor.distance_m,
                criteria=criteria,
                limitations=limitations,
                notes=notes,
            )
        )
    return rank(scored, request.weights)
