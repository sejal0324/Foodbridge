"""Loading, cleaning and exploratory summary of restaurant daily metrics."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pandas as pd

KEY = ["restaurant_id", "date", "meal_period"]
QTY = ["prepared_qty", "sold_qty", "surplus_qty"]
WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


REQUIRED_COLUMNS = (
    "restaurant_id",
    "date",
    "meal_period",
    "prepared_qty",
    "sold_qty",
    "surplus_qty",
    "is_holiday",
    "data_source",
)
# Descriptive columns present in the synthetic dataset; optional for real exports.
OPTIONAL_COLUMNS = {
    "restaurant_type": "UNKNOWN",
    "restaurant_size": "UNKNOWN",
    "unit": "MEALS",
    "holiday_name": pd.NA,
    "special_event": pd.NA,
}


def load_raw(path: Path) -> pd.DataFrame:
    """Read a daily-metrics CSV (one row per restaurant, date and meal period)."""
    df = pd.read_csv(path, dtype="string", keep_default_na=True)
    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"dataset is missing required columns: {', '.join(missing)}")
    for column, default in OPTIONAL_COLUMNS.items():
        if column not in df.columns:
            df[column] = pd.Series(default, index=df.index, dtype="string")
    df["date"] = pd.to_datetime(df["date"], format="%Y-%m-%d")
    df["is_holiday"] = df["is_holiday"].str.strip().str.lower().isin(["true", "1", "t", "yes"])
    for col in QTY:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    return df


def training_data_label(df: pd.DataFrame) -> str:
    """SYNTHETIC, REAL or MIXED, derived from the mandatory ``data_source`` column.

    Rows are SYNTHETIC unless explicitly marked DONOR_ENTERED or IMPORTED, so a
    model can never claim REAL data it was not trained on.
    """
    if "data_source" not in df.columns:
        raise ValueError(
            "dataset must have a data_source column (SYNTHETIC/DONOR_ENTERED/IMPORTED)"
        )
    sources = set(df["data_source"].fillna("SYNTHETIC").str.upper().unique().tolist())
    real = sources & {"DONOR_ENTERED", "IMPORTED"}
    synthetic = sources - {"DONOR_ENTERED", "IMPORTED"}
    if real and synthetic:
        return "MIXED"
    return "REAL" if real else "SYNTHETIC"


def _ratio(surplus: pd.Series, prepared: pd.Series) -> float:
    total = float(prepared.sum())
    return round(float(surplus.sum()) / total, 4) if total else 0.0


def _mean(values: pd.Series) -> float | None:
    """Rounded mean, or None for an empty selection."""
    mean = values.mean()
    return None if pd.isna(mean) else round(float(mean), 2)


def eda_summary(df: pd.DataFrame) -> dict[str, Any]:
    """Exploratory summary of the raw data (before cleaning)."""
    labels = sorted(df["data_source"].dropna().unique().tolist())
    clean = df.dropna(subset=QTY)
    by_weekday = clean.groupby(clean["date"].dt.day_of_week)
    by_month = clean.groupby(clean["date"].dt.to_period("M").astype(str))
    surplus = clean["surplus_qty"]
    summary: dict[str, Any] = {
        "rows": len(df),
        "restaurants": int(df["restaurant_id"].nunique()),
        "date_min": df["date"].min().date().isoformat(),
        "date_max": df["date"].max().date().isoformat(),
        "data_source_labels": labels,
        "rows_by_meal_period": {
            str(k): int(v) for k, v in df["meal_period"].value_counts().sort_index().items()
        },
        "restaurants_by_type": {
            str(k): int(v)
            for k, v in df.groupby("restaurant_type")["restaurant_id"].nunique().items()
        },
        "restaurants_by_size": {
            str(k): int(v)
            for k, v in df.groupby("restaurant_size")["restaurant_id"].nunique().items()
        },
        "missing_values": {col: int(df[col].isna().sum()) for col in QTY},
        "duplicate_key_rows": int(df.duplicated(subset=KEY).sum()),
        "surplus_qty": {
            "mean": round(float(surplus.mean()), 2),
            "median": round(float(surplus.median()), 2),
            "p90": round(float(surplus.quantile(0.9)), 2),
            "max": float(surplus.max()),
            "zero_share": round(float((surplus == 0).mean()), 4),
        },
        "overall_surplus_ratio": _ratio(clean["surplus_qty"], clean["prepared_qty"]),
        "surplus_ratio_by_type": {
            str(k): _ratio(g["surplus_qty"], g["prepared_qty"])
            for k, g in clean.groupby("restaurant_type")
        },
        "mean_surplus_by_weekday": {
            WEEKDAYS[int(k)]: _mean(g["surplus_qty"]) for k, g in by_weekday
        },
        "mean_surplus_by_month": {str(k): _mean(g["surplus_qty"]) for k, g in by_month},
        "mean_surplus_holiday_vs_not": {
            "holiday": _mean(clean.loc[clean["is_holiday"], "surplus_qty"]),
            "non_holiday": _mean(clean.loc[~clean["is_holiday"], "surplus_qty"]),
        },
        "mean_surplus_event_vs_not": {
            "event": _mean(clean.loc[clean["special_event"].notna(), "surplus_qty"]),
            "no_event": _mean(clean.loc[clean["special_event"].isna(), "surplus_qty"]),
        },
    }
    return summary


def clean(df: pd.DataFrame) -> tuple[pd.DataFrame, dict[str, int]]:
    """Deduplicate, repair derivable missing values, drop the rest, enforce invariants."""
    report: dict[str, int] = {"rows_in": len(df)}
    df = df.drop_duplicates(subset=KEY, keep="first").copy()
    report["duplicates_dropped"] = report["rows_in"] - len(df)

    fill_surplus = df["surplus_qty"].isna() & df["prepared_qty"].notna() & df["sold_qty"].notna()
    df.loc[fill_surplus, "surplus_qty"] = (
        df.loc[fill_surplus, "prepared_qty"] - df.loc[fill_surplus, "sold_qty"]
    )
    fill_sold = df["sold_qty"].isna() & df["prepared_qty"].notna() & df["surplus_qty"].notna()
    df.loc[fill_sold, "sold_qty"] = (
        df.loc[fill_sold, "prepared_qty"] - df.loc[fill_sold, "surplus_qty"]
    )
    report["surplus_imputed_from_prepared_minus_sold"] = int(fill_surplus.sum())
    report["sold_imputed_from_prepared_minus_surplus"] = int(fill_sold.sum())

    before = len(df)
    df = df.dropna(subset=QTY)
    report["rows_dropped_missing"] = before - len(df)

    before = len(df)
    valid = (
        (df[QTY] >= 0).all(axis=1)
        & (df["sold_qty"] <= df["prepared_qty"])
        & (df["surplus_qty"] <= df["prepared_qty"])
    )
    df = df.loc[valid].copy()
    report["rows_dropped_invalid"] = before - len(df)

    for col in QTY:
        df[col] = df[col].astype("int64")
    df["special_event"] = df["special_event"].fillna("")
    df = df.sort_values(KEY, kind="stable").reset_index(drop=True)
    report["rows_out"] = len(df)
    return df, report
