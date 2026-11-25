"""The shipped forecaster artifact: metadata honesty, integrity and train/serve parity."""

from __future__ import annotations

import datetime as dt
import json
import re
import shutil
from pathlib import Path

import joblib
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.services.features import FEATURE_COLUMNS, PeriodHistory, compute_features, denormalize
from app.services.model_artifact import (
    ARTIFACT_DIR,
    ARTIFACT_NAME,
    META_NAME,
    load_forecaster,
    sha256_file,
)
from tests.conftest import AUTH
from training import data as data_mod

ROOT = Path(__file__).resolve().parent.parent
DATASET = ROOT / "datasets" / "synthetic_restaurant_metrics.csv"


@pytest.fixture(scope="module")
def meta() -> dict:
    return json.loads((ARTIFACT_DIR / META_NAME).read_text(encoding="utf-8"))


def test_selected_model_beats_or_equals_baseline_on_test(meta: dict) -> None:
    models = meta["metrics"]["models"]
    selected = models[meta["metrics"]["selected"]]
    assert selected["test"]["mae"] <= models["baseline"]["test"]["mae"]
    assert set(models) == {
        "baseline",
        "linear_regression",
        "random_forest",
        "hist_gradient_boosting",
    }
    for result in models.values():
        for split in ("validation", "test"):
            assert result[split]["mae"] > 0 and result[split]["rmse"] >= result[split]["mae"]


def test_selection_rule_is_validation_mae(meta: dict) -> None:
    models = meta["metrics"]["models"]
    ml = {k: v for k, v in models.items() if k != "baseline"}
    best = min(ml, key=lambda k: ml[k]["validation"]["mae"])
    expected = (
        best
        if ml[best]["validation"]["mae"] < models["baseline"]["validation"]["mae"]
        else "baseline"
    )
    assert meta["metrics"]["selected"] == expected


def test_metadata_is_labelled_synthetic_and_complete(meta: dict) -> None:
    assert meta["training_data_label"] == "SYNTHETIC"
    assert re.fullmatch(r"sf-\d{8}-[0-9a-f]{8}", meta["version"])
    assert meta["version"].endswith(meta["artifact_sha256"][:8])
    assert meta["dataset"]["sha256"] == sha256_file(DATASET)
    assert meta["split"]["method"].startswith("chronological")
    assert meta["split"]["train"][1] < meta["split"]["validation"][0]
    assert meta["split"]["validation"][1] < meta["split"]["test"][0]
    assert meta["interval"]["lower"] < 0 < meta["interval"]["upper"]
    assert all(meta["row_counts"][k] > 0 for k in ("train", "validation", "test"))


def test_features_match_training(meta: dict) -> None:
    assert meta["features"] == list(FEATURE_COLUMNS)
    bundle = joblib.load(ARTIFACT_DIR / ARTIFACT_NAME)
    assert bundle["feature_columns"] == list(FEATURE_COLUMNS)
    if bundle["estimator"] is not None:
        assert bundle["estimator"].n_features_in_ == len(FEATURE_COLUMNS)


def test_artifact_integrity_and_size(meta: dict) -> None:
    path = ARTIFACT_DIR / ARTIFACT_NAME
    assert sha256_file(path) == meta["artifact_sha256"]
    assert path.stat().st_size < 10 * 1024 * 1024
    for result in meta["metrics"]["models"].values():
        assert result.get("serialized_kib", 0) < 10 * 1024


def test_tampered_artifact_is_not_loaded(tmp_path: Path) -> None:
    for name in (ARTIFACT_NAME, META_NAME):
        shutil.copy(ARTIFACT_DIR / name, tmp_path / name)
    assert load_forecaster(tmp_path) is not None
    meta = json.loads((tmp_path / META_NAME).read_text())
    meta["artifact_sha256"] = "0" * 64
    (tmp_path / META_NAME).write_text(json.dumps(meta))
    assert load_forecaster(tmp_path) is None


def test_feature_list_mismatch_is_not_loaded(tmp_path: Path) -> None:
    for name in (ARTIFACT_NAME, META_NAME):
        shutil.copy(ARTIFACT_DIR / name, tmp_path / name)
    meta = json.loads((tmp_path / META_NAME).read_text())
    meta["features"] = meta["features"][:-1]
    (tmp_path / META_NAME).write_text(json.dumps(meta))
    assert load_forecaster(tmp_path) is None


def test_serving_matches_training_feature_path(client: TestClient) -> None:
    """The API's forecast equals the model applied to training-path features."""
    df, _ = data_mod.clean(data_mod.load_raw(DATASET))
    group = df[(df["restaurant_id"] == "SYN-R002") & (df["meal_period"] == "LUNCH")]
    group = group.sort_values("date").iloc[:120]
    dates = [ts.date() for ts in group["date"]]
    target = dates[-1] + dt.timedelta(days=3)

    # Training path.
    history = PeriodHistory.from_rows(dates, group["prepared_qty"], group["surplus_qty"])
    row = compute_features(
        history,
        history.rows_before(target),
        target_date=target,
        meal_period="LUNCH",
        is_holiday=False,
        special_event=None,
        planned_prepared_qty=None,
    )
    assert row is not None
    forecaster = load_forecaster()
    assert forecaster is not None and forecaster.estimator is not None
    norm = forecaster.estimator.predict(np.array([row.values]))
    expected = denormalize(norm, np.array([row.scale]), np.array([np.nan]))[0]

    # Serving path.
    body = {
        "donor_id": "SYN-R002",
        "unit": "MEALS",
        "history": [
            {
                "date": d.isoformat(),
                "meal_period": "LUNCH",
                "prepared_qty": int(p),
                "sold_qty": int(s),
                "surplus_qty": int(q),
                "is_holiday": bool(h),
                "special_event": e or None,
            }
            for d, p, s, q, h, e in zip(
                dates,
                group["prepared_qty"],
                group["sold_qty"],
                group["surplus_qty"],
                group["is_holiday"],
                group["special_event"],
                strict=True,
            )
        ],
        "targets": [{"date": target.isoformat(), "meal_period": "LUNCH"}],
    }
    response = client.post("/ai/predict-surplus", json=body, headers=AUTH).json()
    assert response["predictions"][0]["predicted_qty"] == int(np.floor(expected + 0.5))
