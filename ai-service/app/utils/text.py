"""Small deterministic text helpers for explanations."""

from __future__ import annotations

from collections.abc import Sequence

_UNIT_WORDS: dict[str, tuple[str, str]] = {
    "MEALS": ("meal", "meals"),
    "PACKETS": ("packet", "packets"),
    "BOXES": ("box", "boxes"),
}

DISTANCE_SOURCE_LABELS: dict[str, str] = {
    "STRAIGHT_LINE_ESTIMATE": "straight-line estimate",
    "ROAD_GOOGLE_ROUTES": "road distance",
}


def fmt_number(value: float) -> str:
    """12 -> "12", 12.25 -> "12.2" (one decimal only when needed)."""
    rounded = round(value, 1)
    return str(int(rounded)) if rounded == int(rounded) else f"{rounded:.1f}"


def fmt_distance(metres: float) -> str:
    if metres < 1000:
        return f"{round(metres)} m"
    return f"{fmt_number(metres / 1000)} km"


def unit_word(unit: str, quantity: float) -> str:
    singular, plural = _UNIT_WORDS.get(unit, (unit.lower(), unit.lower()))
    return singular if quantity == 1 else plural


def join_phrases(phrases: Sequence[str]) -> str:
    """["a"] -> "a"; ["a", "b"] -> "a and b"; ["a", "b", "c"] -> "a, b and c"."""
    if not phrases:
        return ""
    if len(phrases) == 1:
        return phrases[0]
    return ", ".join(phrases[:-1]) + " and " + phrases[-1]
