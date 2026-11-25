"""Train, evaluate and export the surplus forecaster.

    .venv/bin/python -m training.train [--dataset PATH]

Pipeline: EDA summary -> cleaning -> shared feature engineering
(``app.services.features``) -> chronological train/validation/test split by
target date -> baseline + LinearRegression + RandomForest + HistGradientBoosting
-> selection by validation MAE (must beat the baseline, otherwise the baseline
ships) -> refit on train+validation -> test metrics, residual analysis,
interval coverage -> artifact + meta JSON + report.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import io
import json
import platform
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import numpy.typing as npt
import pandas as pd
import sklearn
from sklearn.base import RegressorMixin, clone
from sklearn.ensemble import HistGradientBoostingRegressor, RandomForestRegressor
from sklearn.linear_model import LinearRegression

from app.services.features import (
    FEATURE_COLUMNS,
    MAX_HORIZON_DAYS,
    MIN_HISTORY_ROWS,
    FeatureRow,
    PeriodHistory,
    compute_features,
    denormalize,
    feature_matrix,
)
from app.services.model_artifact import BASELINE_ALGORITHM, save_artifact
from training import data as data_mod
from training.evaluation import metrics, residual_analysis

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DATASET = ROOT / "datasets" / "synthetic_restaurant_metrics.csv"
REPORT_PATH = ROOT / "training" / "reports" / "training_report.json"

SEED = 42
TRAIN_SHARE, VALIDATION_SHARE = 0.70, 0.15
PLANNED_SHARE = 0.30  # share of training rows that simulate a known planned_prepared_qty
INTERVAL_QUANTILES = (0.10, 0.90)
FloatArray = npt.NDArray[np.float64]

CANDIDATES: dict[str, RegressorMixin] = {
    "linear_regression": LinearRegression(),
    "random_forest": RandomForestRegressor(
        n_estimators=120,
        max_depth=12,
        min_samples_leaf=20,
        max_features=0.5,
        random_state=SEED,
        n_jobs=-1,
    ),
    "hist_gradient_boosting": HistGradientBoostingRegressor(
        learning_rate=0.05,
        max_iter=400,
        max_leaf_nodes=31,
        min_samples_leaf=40,
        l2_regularization=1.0,
        early_stopping=False,
        random_state=SEED,
    ),
}


@dataclass
class FeatureTable:
    x: FloatArray
    meta: pd.DataFrame  # one row per feature row: target, scale, baseline, split, context


def build_feature_table(df: pd.DataFrame, seed: int = SEED) -> FeatureTable:
    """Features for every row with enough history, via the shared feature module.

    Each row gets a random forecast horizon h in [1, MAX_HORIZON_DAYS]: only
    history on or before ``date - h`` is visible, exactly as at inference when
    the backend forecasts h days past the last history row it sends.
    """
    rng = np.random.default_rng(seed)
    rows: list[FeatureRow] = []
    records: list[dict[str, Any]] = []
    for (restaurant_id, meal_period), group in df.groupby(
        ["restaurant_id", "meal_period"], sort=True
    ):
        dates = [ts.date() for ts in group["date"]]
        history = PeriodHistory.from_rows(dates, group["prepared_qty"], group["surplus_qty"])
        horizons = rng.integers(1, MAX_HORIZON_DAYS + 1, size=len(group))
        planned_mask = rng.random(len(group)) < PLANNED_SHARE
        for i, row in enumerate(group.itertuples(index=False)):
            target = dates[i]
            cutoff = target - dt.timedelta(days=int(horizons[i]))
            planned = float(row.prepared_qty) if planned_mask[i] else None
            feature_row = compute_features(
                history,
                history.rows_on_or_before(cutoff),
                target_date=target,
                meal_period=str(meal_period),
                is_holiday=bool(row.is_holiday),
                special_event=str(row.special_event) or None,
                planned_prepared_qty=planned,
            )
            if feature_row is None:
                continue
            rows.append(feature_row)
            records.append(
                {
                    "restaurant_id": restaurant_id,
                    "restaurant_size": row.restaurant_size,
                    "meal_period": meal_period,
                    "date": target,
                    "weekday": target.weekday(),
                    "is_holiday": bool(row.is_holiday),
                    "has_event": bool(row.special_event),
                    "actual": float(row.surplus_qty),
                    "scale": feature_row.scale,
                    "baseline_qty": feature_row.baseline_qty,
                    "horizon_days": feature_row.horizon_days,
                    "planned": planned if planned is not None else np.nan,
                }
            )
    return FeatureTable(x=feature_matrix(rows), meta=pd.DataFrame.from_records(records))


def chronological_split(dates: pd.Series) -> dict[str, dt.date]:
    unique = sorted(dates.unique())
    n = len(unique)
    return {
        "validation_start": unique[int(n * TRAIN_SHARE)],
        "test_start": unique[int(n * (TRAIN_SHARE + VALIDATION_SHARE))],
        "first": unique[0],
        "last": unique[-1],
    }


def _predict_quantity(
    model: RegressorMixin | None, x: FloatArray, meta: pd.DataFrame
) -> FloatArray:
    scale = meta["scale"].to_numpy(dtype=np.float64)
    planned = meta["planned"].to_numpy(dtype=np.float64)
    if model is None:  # baseline: same-weekday trailing mean, in quantity units
        norm = meta["baseline_qty"].to_numpy(dtype=np.float64) / scale
    else:
        norm = np.asarray(model.predict(x), dtype=np.float64)
    return denormalize(norm, scale, planned)


def _serialized_kib(model: RegressorMixin) -> float:
    """Compressed size the model would have as the shipped artifact."""
    buffer = io.BytesIO()
    joblib.dump(model, buffer, compress=("zlib", 6))
    return round(buffer.getbuffer().nbytes / 1024, 1)


def _interval(actual: FloatArray, predicted: FloatArray, scale: FloatArray) -> dict[str, Any]:
    normalised = (actual - predicted) / scale
    low_q, high_q = INTERVAL_QUANTILES
    return {
        "lower_quantile": low_q,
        "upper_quantile": high_q,
        "lower": round(float(np.quantile(normalised, low_q)), 6),
        "upper": round(float(np.quantile(normalised, high_q)), 6),
    }


def _apply_interval(
    predicted: FloatArray, meta: pd.DataFrame, interval: dict[str, Any]
) -> tuple[FloatArray, FloatArray]:
    scale = meta["scale"].to_numpy(dtype=np.float64)
    planned = meta["planned"].to_numpy(dtype=np.float64)
    lower = denormalize(predicted / scale + interval["lower"], scale, planned)
    upper = denormalize(predicted / scale + interval["upper"], scale, planned)
    return np.minimum(lower, predicted), np.maximum(upper, predicted)


def _sample_predictions(
    test_meta: pd.DataFrame, predicted: FloatArray, lower: FloatArray, upper: FloatArray
) -> list[dict[str, Any]]:
    frame = test_meta.assign(predicted=predicted, lower=lower, upper=upper)
    rng = np.random.default_rng(SEED)
    picks = sorted(rng.choice(len(frame), size=12, replace=False).tolist())
    holiday_rows = frame.index[frame["is_holiday"]].tolist()[:3]
    samples = []
    for idx in sorted(set(picks) | set(holiday_rows)):
        row = frame.iloc[idx]
        samples.append(
            {
                "restaurant_id": row["restaurant_id"],
                "date": row["date"].isoformat(),
                "meal_period": row["meal_period"],
                "horizon_days": int(row["horizon_days"]),
                "is_holiday": bool(row["is_holiday"]),
                "actual": int(row["actual"]),
                "predicted": round(float(row["predicted"])),
                "interval": [round(float(row["lower"])), round(float(row["upper"]))],
                "baseline": round(float(row["baseline_qty"])),
            }
        )
    return samples


def train(dataset: Path) -> dict[str, Any]:
    dataset_sha = hashlib.sha256(dataset.read_bytes()).hexdigest()
    raw = data_mod.load_raw(dataset)
    data_label = data_mod.training_data_label(raw)
    eda = data_mod.eda_summary(raw)
    cleaned, cleaning = data_mod.clean(raw)
    split = chronological_split(cleaned["date"].dt.date)

    table = build_feature_table(cleaned)
    dates = table.meta["date"]
    masks = {
        "train": (dates < split["validation_start"]).to_numpy(),
        "validation": (
            (dates >= split["validation_start"]) & (dates < split["test_start"])
        ).to_numpy(),
        "test": (dates >= split["test_start"]).to_numpy(),
    }
    xs = {name: table.x[mask] for name, mask in masks.items()}
    ms = {name: table.meta.loc[mask].reset_index(drop=True) for name, mask in masks.items()}
    y_norm = {name: (m["actual"] / m["scale"]).to_numpy() for name, m in ms.items()}
    actual = {name: m["actual"].to_numpy(dtype=np.float64) for name, m in ms.items()}

    results: dict[str, dict[str, Any]] = {}
    val_predictions: dict[str, FloatArray] = {}

    # Baseline has no parameters to fit.
    val_predictions["baseline"] = _predict_quantity(None, xs["validation"], ms["validation"])
    results["baseline"] = {
        "algorithm": BASELINE_ALGORITHM,
        "validation": metrics(actual["validation"], val_predictions["baseline"]),
        "test": metrics(actual["test"], _predict_quantity(None, xs["test"], ms["test"])),
    }

    fitted_full: dict[str, RegressorMixin] = {}
    train_val_x = np.vstack([xs["train"], xs["validation"]])
    train_val_y = np.concatenate([y_norm["train"], y_norm["validation"]])
    for name, prototype in CANDIDATES.items():
        model = clone(prototype).fit(xs["train"], y_norm["train"])
        val_predictions[name] = _predict_quantity(model, xs["validation"], ms["validation"])
        full = clone(prototype).fit(train_val_x, train_val_y)
        fitted_full[name] = full
        results[name] = {
            "algorithm": type(prototype).__name__,
            "validation": metrics(actual["validation"], val_predictions[name]),
            "test": metrics(actual["test"], _predict_quantity(full, xs["test"], ms["test"])),
            "serialized_kib": _serialized_kib(full),
        }
        print(f"  {name:<24} val MAE {results[name]['validation']['mae']:.3f}")

    best_ml = min(CANDIDATES, key=lambda n: results[n]["validation"]["mae"])
    beats_baseline = (
        results[best_ml]["validation"]["mae"] < results["baseline"]["validation"]["mae"]
    )
    selected = best_ml if beats_baseline else "baseline"
    selected_model = fitted_full.get(selected)

    interval = _interval(
        actual["validation"],
        val_predictions[selected],
        ms["validation"]["scale"].to_numpy(dtype=np.float64),
    )
    test_pred = _predict_quantity(selected_model, xs["test"], ms["test"])
    lower, upper = _apply_interval(test_pred, ms["test"], interval)
    residuals = residual_analysis(ms["test"].assign(predicted=test_pred, lower=lower, upper=upper))
    interval["source"] = "validation residuals of the selected model, normalised by scale"
    interval["test_coverage"] = residuals["interval_coverage"]

    trained_at = dt.datetime.now(dt.UTC).replace(microsecond=0)
    meta: dict[str, Any] = {
        "model_name": "surplus_forecaster",
        "version": f"sf-{trained_at:%Y%m%d}-<hash8>",
        "algorithm": results[selected]["algorithm"],
        "selected_model": selected,
        "trained_at": trained_at.isoformat().replace("+00:00", "Z"),
        "training_data_label": data_label,
        "dataset": {
            "file": dataset.relative_to(ROOT).as_posix()
            if dataset.is_relative_to(ROOT)
            else dataset.name,
            "sha256": dataset_sha,
            "rows_raw": cleaning["rows_in"],
            "rows_clean": cleaning["rows_out"],
        },
        "row_counts": {name: int(mask.sum()) for name, mask in masks.items()},
        "split": {
            "method": "chronological by target date, no shuffling",
            "train": [split["first"].isoformat(), _day_before(split["validation_start"])],
            "validation": [split["validation_start"].isoformat(), _day_before(split["test_start"])],
            "test": [split["test_start"].isoformat(), split["last"].isoformat()],
        },
        "features": list(FEATURE_COLUMNS),
        "target": "surplus_qty / scale; scale = mean prepared_qty of the last 28 "
        "observations (>=1)",
        "min_history_rows": MIN_HISTORY_ROWS,
        "training_horizon_days": [1, MAX_HORIZON_DAYS],
        "planned_prepared_share": PLANNED_SHARE,
        "metrics": {
            "selection_metric": "validation_mae",
            "selected": selected,
            "selected_beats_baseline_on_validation": beats_baseline,
            "models": results,
        },
        "interval": interval,
        "hyperparameters": {
            name: {k: v for k, v in proto.get_params().items() if k != "n_jobs"}
            for name, proto in CANDIDATES.items()
        },
        "library_versions": {
            "python": platform.python_version(),
            "scikit-learn": sklearn.__version__,
            "numpy": np.__version__,
            "pandas": pd.__version__,
        },
        "seed": SEED,
    }
    final_meta = save_artifact(selected_model, meta)

    report = {
        "model_version": final_meta["version"],
        "training_data_label": data_label,
        "eda": eda,
        "cleaning": cleaning,
        "split": meta["split"],
        "row_counts": meta["row_counts"],
        "metrics": meta["metrics"],
        "interval": interval,
        "residual_analysis_test": residuals,
        "actual_vs_predicted_test_samples": _sample_predictions(
            ms["test"], test_pred, lower, upper
        ),
    }
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(json.dumps(report, indent=2, default=str) + "\n", encoding="utf-8")
    return report | {"artifact_bytes": final_meta["artifact_bytes"]}


def _day_before(day: dt.date) -> str:
    return (day - dt.timedelta(days=1)).isoformat()


def _print_report(report: dict[str, Any]) -> None:
    eda = report["eda"]
    print(f"\nTraining data label: {report['training_data_label']}")
    print(
        f"EDA: {eda['rows']} rows, {eda['restaurants']} restaurants, "
        f"{eda['date_min']}..{eda['date_max']}, missing={eda['missing_values']}, "
        f"duplicate keys={eda['duplicate_key_rows']}"
    )
    print(
        f"     surplus ratio overall={eda['overall_surplus_ratio']} "
        f"by type={eda['surplus_ratio_by_type']}"
    )
    print(f"Cleaning: {report['cleaning']}")
    print(f"Split: {report['split']}  rows={report['row_counts']}")
    print(f"\n{'model':<24}{'val MAE':>10}{'val RMSE':>10}{'test MAE':>10}{'test RMSE':>11}")
    for name, res in report["metrics"]["models"].items():
        v, t = res["validation"], res["test"]
        print(f"{name:<24}{v['mae']:>10.3f}{v['rmse']:>10.3f}{t['mae']:>10.3f}{t['rmse']:>11.3f}")
    print(f"\nSelected: {report['metrics']['selected']}  version: {report['model_version']}")
    print(f"Interval: {report['interval']}")
    res = report["residual_analysis_test"]
    print(f"Test bias (actual - predicted): {res['bias_actual_minus_predicted']}")
    print(f"Artifact size: {report['artifact_bytes'] / 1024:.0f} KiB")
    print(f"Report: {REPORT_PATH}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Train the surplus forecaster.")
    parser.add_argument(
        "--dataset",
        type=Path,
        default=DEFAULT_DATASET,
        help="CSV with the columns of datasets/synthetic_restaurant_metrics.csv; the "
        "training data label is derived from its data_source column",
    )
    args = parser.parse_args()
    print(f"Training on {args.dataset} ...")
    _print_report(train(args.dataset.resolve()))


if __name__ == "__main__":
    main()
