"""Generate the SYNTHETIC restaurant daily-metrics dataset used to train the forecaster.

Every row is invented by this script and labelled ``data_source=SYNTHETIC``.
No real restaurant data is used. The dataset exists so that the forecasting
pipeline (features, training, evaluation, serving) can be built and tested
before real donor history exists; see ``datasets/README.md``.

The generator is deterministic: the same seed produces a byte-identical CSV.

    .venv/bin/python -m training.generate_dataset
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
from dataclasses import dataclass
from pathlib import Path

import numpy as np

SEED = 20251101
N_RESTAURANTS = 40
START_DATE = dt.date(2025, 9, 1)
N_DAYS = 400
OUTPUT = Path(__file__).resolve().parent.parent / "datasets" / "synthetic_restaurant_metrics.csv"

# Approximate public holiday / festival dates in India for the simulated period.
# Dates of lunar festivals are approximations; they only need to be plausible.
HOLIDAYS: dict[dt.date, str] = {
    dt.date(2025, 10, 2): "Gandhi Jayanti / Dussehra",
    dt.date(2025, 10, 20): "Diwali",
    dt.date(2025, 10, 21): "Diwali (Govardhan Puja)",
    dt.date(2025, 11, 5): "Guru Nanak Jayanti",
    dt.date(2025, 12, 25): "Christmas",
    dt.date(2026, 1, 1): "New Year's Day",
    dt.date(2026, 1, 14): "Makar Sankranti / Pongal",
    dt.date(2026, 1, 26): "Republic Day",
    dt.date(2026, 3, 4): "Holi",
    dt.date(2026, 3, 21): "Eid al-Fitr",
    dt.date(2026, 4, 3): "Good Friday",
    dt.date(2026, 4, 14): "Ambedkar Jayanti",
    dt.date(2026, 5, 1): "Labour Day",
    dt.date(2026, 5, 27): "Eid al-Adha",
    dt.date(2026, 8, 15): "Independence Day",
    dt.date(2026, 8, 28): "Raksha Bandhan",
    dt.date(2026, 9, 14): "Ganesh Chaturthi",
}


@dataclass(frozen=True)
class Archetype:
    """Restaurant archetype behaviour."""

    weekday: tuple[float, ...]  # demand multipliers Mon..Sun
    periods: dict[str, float]  # meal periods served and their size multipliers
    holiday: float  # demand multiplier on public holidays/festivals
    closed_sunday: bool


ARCHETYPES: dict[str, Archetype] = {
    "OFFICE_CANTEEN": Archetype(
        weekday=(1.05, 1.05, 1.05, 1.05, 1.00, 0.55, 0.35),
        periods={"BREAKFAST": 0.50, "LUNCH": 1.00, "DINNER": 0.55},
        holiday=0.40,
        closed_sunday=True,
    ),
    "FAMILY_DINING": Archetype(
        weekday=(0.85, 0.85, 0.90, 0.90, 1.05, 1.30, 1.35),
        periods={"BREAKFAST": 0.40, "LUNCH": 1.00, "DINNER": 1.30},
        holiday=1.25,
        closed_sunday=False,
    ),
    "QUICK_SERVICE": Archetype(
        weekday=(0.95, 0.95, 0.95, 1.00, 1.05, 1.10, 1.05),
        periods={"BREAKFAST": 0.45, "LUNCH": 1.00, "DINNER": 1.10},
        holiday=1.10,
        closed_sunday=False,
    ),
    "BAKERY_CAFE": Archetype(
        weekday=(0.90, 0.90, 0.95, 0.95, 1.05, 1.20, 1.20),
        periods={"ALL_DAY": 1.00},
        holiday=1.40,
        closed_sunday=False,
    ),
}
ARCHETYPE_COUNTS = {
    "OFFICE_CANTEEN": 10,
    "FAMILY_DINING": 14,
    "QUICK_SERVICE": 12,
    "BAKERY_CAFE": 4,
}
SIZE_BASE = {"SMALL": (60, 110), "MEDIUM": (120, 220), "LARGE": (250, 450)}
# Common monthly seasonality (Jan..Dec): summer and monsoon dip, festive/wedding peak.
MONTHLY = (1.02, 1.00, 0.98, 0.95, 0.92, 0.94, 0.90, 0.92, 0.97, 1.03, 1.06, 1.08)
# Pre-announced events: (preparation multiplier, demand multiplier).
EVENTS: dict[str, tuple[float, float]] = {
    "CATERING_ORDER": (1.35, 1.30),
    "LOCAL_FESTIVAL": (1.25, 1.08),
    "CRICKET_MATCH": (1.10, 0.90),
    "PRIVATE_PARTY": (1.30, 1.22),
}
EVENT_PROBABILITY = 0.025
CLOSED_DAY_PROBABILITY = 0.015
MISSING_SURPLUS_PROBABILITY = 0.004
MISSING_SOLD_PROBABILITY = 0.002
DUPLICATE_ROWS = 12

COLUMNS = (
    "restaurant_id",
    "restaurant_type",
    "restaurant_size",
    "date",
    "meal_period",
    "unit",
    "prepared_qty",
    "sold_qty",
    "surplus_qty",
    "is_holiday",
    "holiday_name",
    "special_event",
    "data_source",
)


@dataclass(frozen=True)
class Restaurant:
    restaurant_id: str
    archetype: str
    size: str
    base: float
    periods: tuple[str, ...]
    growth_per_year: float
    buffer: float
    noise_sigma: float
    season_amplitude: float


def _make_restaurants(rng: np.random.Generator) -> list[Restaurant]:
    restaurants: list[Restaurant] = []
    index = 1
    for archetype, count in ARCHETYPE_COUNTS.items():
        periods_all = tuple(ARCHETYPES[archetype].periods)
        for _ in range(count):
            size = str(rng.choice(["SMALL", "MEDIUM", "LARGE"], p=[0.4, 0.4, 0.2]))
            low, high = SIZE_BASE[size]
            if archetype == "BAKERY_CAFE":
                periods = periods_all
            elif rng.random() < 0.35:
                periods = ("BREAKFAST", "LUNCH", "DINNER")
            else:
                periods = ("LUNCH", "DINNER")
            restaurants.append(
                Restaurant(
                    restaurant_id=f"SYN-R{index:03d}",
                    archetype=archetype,
                    size=size,
                    base=float(rng.uniform(low, high)),
                    periods=periods,
                    growth_per_year=float(rng.uniform(-0.12, 0.18)),
                    buffer=float(rng.uniform(0.06, 0.25)),
                    noise_sigma=float(rng.uniform(0.08, 0.16)),
                    season_amplitude=float(rng.uniform(0.5, 1.5)),
                )
            )
            index += 1
    return restaurants


def _simulate_restaurant(r: Restaurant, rng: np.random.Generator) -> list[dict[str, object]]:
    spec = ARCHETYPES[r.archetype]
    weekday_mult, period_mult = spec.weekday, spec.periods
    holiday_mult, closed_sunday = spec.holiday, spec.closed_sunday

    # Slowly drifting local demand level (AR(1)); the restaurant plans with a
    # one-week-old perception of it, so recent history carries signal.
    level = np.ones(N_DAYS + 7)
    for t in range(1, N_DAYS + 7):
        level[t] = 1.0 + 0.97 * (level[t - 1] - 1.0) + rng.normal(0.0, 0.02)

    rows: list[dict[str, object]] = []
    for t in range(N_DAYS):
        day = START_DATE + dt.timedelta(days=t)
        weekday = day.weekday()
        if (closed_sunday and weekday == 6) or rng.random() < CLOSED_DAY_PROBABILITY:
            continue
        holiday_name = HOLIDAYS.get(day)
        is_holiday = holiday_name is not None
        season = 1.0 + r.season_amplitude * (MONTHLY[day.month - 1] - 1.0)
        trend = 1.0 + r.growth_per_year * t / 365.0
        monsoon = day.month in (6, 7, 8, 9)
        rain_shock = rng.random() < (0.12 if monsoon else 0.03)

        for period in r.periods:
            event = str(rng.choice(list(EVENTS))) if rng.random() < EVENT_PROBABILITY else None
            prep_event, demand_event = EVENTS[event] if event else (1.0, 1.0)
            expected = r.base * period_mult[period] * weekday_mult[weekday] * season * trend
            # Restaurants anticipate only half of a holiday's effect.
            holiday_demand = holiday_mult if is_holiday else 1.0
            holiday_plan = 1.0 + 0.5 * (holiday_mult - 1.0) if is_holiday else 1.0

            planned = expected * level[t] * (1.0 + r.buffer) * holiday_plan * prep_event
            prepared = max(1, round(planned * rng.lognormal(0.0, 0.04)))
            demand = (
                expected
                * level[t + 7]
                * holiday_demand
                * demand_event
                * (0.75 if rain_shock else 1.0)
                * rng.lognormal(0.0, r.noise_sigma)
            )
            sold = int(min(prepared, max(0, round(demand))))
            surplus = prepared - sold
            rows.append(
                {
                    "restaurant_id": r.restaurant_id,
                    "restaurant_type": r.archetype,
                    "restaurant_size": r.size,
                    "date": day.isoformat(),
                    "meal_period": period,
                    "unit": "MEALS",
                    "prepared_qty": prepared,
                    "sold_qty": sold,
                    "surplus_qty": surplus,
                    "is_holiday": "true" if is_holiday else "false",
                    "holiday_name": holiday_name or "",
                    "special_event": event or "",
                    "data_source": "SYNTHETIC",
                }
            )
    return rows


def _inject_data_quality_issues(
    rows: list[dict[str, object]], rng: np.random.Generator
) -> list[dict[str, object]]:
    """Missing values and duplicate rows, so the training pipeline must clean them."""
    for row in rows:
        roll = rng.random()
        if roll < MISSING_SURPLUS_PROBABILITY:
            row["surplus_qty"] = ""
        elif roll < MISSING_SURPLUS_PROBABILITY + MISSING_SOLD_PROBABILITY:
            row["sold_qty"] = ""
    duplicate_idx = sorted(rng.choice(len(rows), size=DUPLICATE_ROWS, replace=False).tolist())
    out = list(rows)
    for offset, idx in enumerate(duplicate_idx):
        out.insert(idx + offset + 1, dict(rows[idx]))
    return out


def generate(seed: int = SEED) -> list[dict[str, object]]:
    root = np.random.default_rng(seed)
    restaurants = _make_restaurants(root)
    children = np.random.SeedSequence(seed).spawn(len(restaurants) + 1)
    rows: list[dict[str, object]] = []
    for restaurant, child in zip(restaurants, children[:-1], strict=True):
        rows.extend(_simulate_restaurant(restaurant, np.random.default_rng(child)))
    return _inject_data_quality_issues(rows, np.random.default_rng(children[-1]))


def write_csv(rows: list[dict[str, object]], path: Path) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=COLUMNS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--seed", type=int, default=SEED)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()

    rows = generate(args.seed)
    digest = write_csv(rows, args.output)
    size_kb = args.output.stat().st_size / 1024
    print(f"SYNTHETIC dataset written: {args.output}")
    print(f"rows={len(rows)} size={size_kb:.0f} KiB sha256={digest}")


if __name__ == "__main__":
    main()
