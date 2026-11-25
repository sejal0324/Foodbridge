"""Surplus-forecaster artifact format, shared by training (save) and serving (load).

The artifact is two files in ``app/models/artifacts/``:

* ``surplus_forecaster.joblib``: the fitted estimator (or ``None`` when the
  baseline was selected) plus the feature list it was trained on.
* ``surplus_forecaster.meta.json``: version, metrics, data label, interval
  quantiles and the artifact's sha256.

Loading verifies the sha256 and that the stored feature list equals
``features.FEATURE_COLUMNS``; any mismatch makes the model unavailable rather
than serving a model with skewed features. joblib uses pickle, so only load
artifacts shipped with this repository.
"""

from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, Protocol, cast

import joblib
import numpy as np
import numpy.typing as npt

from app.services.features import FEATURE_COLUMNS

logger = logging.getLogger("app.model")

ARTIFACT_DIR = Path(__file__).resolve().parent.parent / "models" / "artifacts"
ARTIFACT_NAME = "surplus_forecaster.joblib"
META_NAME = "surplus_forecaster.meta.json"
FORMAT_VERSION = 1
BASELINE_ALGORITHM = "SameWeekdayTrailingMean"
DataLabel = Literal["SYNTHETIC", "REAL", "MIXED"]
_DATA_LABELS = ("SYNTHETIC", "REAL", "MIXED")


class Regressor(Protocol):
    def predict(self, x: npt.NDArray[np.float64]) -> npt.NDArray[np.float64]: ...


@dataclass(frozen=True)
class IntervalQuantiles:
    """Quantiles of normalised validation residuals (actual - predicted) / scale."""

    lower_quantile: float
    upper_quantile: float
    lower: float
    upper: float


@dataclass(frozen=True)
class Forecaster:
    estimator: Regressor | None  # None: the trailing-mean baseline is used
    algorithm: str
    version: str
    trained_at: str
    training_data_label: DataLabel
    interval: IntervalQuantiles
    meta: dict[str, Any]

    @property
    def basis(self) -> str:
        return "model" if self.estimator is not None else "baseline"

    def summary_metrics(self) -> dict[str, Any]:
        """Compact test-split metrics for /ai/health."""
        metrics = self.meta.get("metrics", {})
        models = metrics.get("models", {})
        selected = models.get(metrics.get("selected"), {}).get("test", {})
        baseline = models.get("baseline", {}).get("test", {})
        return {
            "split": "test (chronological)",
            "mae": selected.get("mae"),
            "rmse": selected.get("rmse"),
            "baseline_mae": baseline.get("mae"),
            "baseline_rmse": baseline.get("rmse"),
            "interval_coverage": self.meta.get("interval", {}).get("test_coverage"),
        }


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save_artifact(
    estimator: Regressor | None,
    meta: dict[str, Any],
    directory: Path = ARTIFACT_DIR,
) -> dict[str, Any]:
    """Write the joblib bundle and the meta JSON. Returns the final meta dict."""
    directory.mkdir(parents=True, exist_ok=True)
    artifact_path = directory / ARTIFACT_NAME
    bundle = {
        "format_version": FORMAT_VERSION,
        "estimator": estimator,
        "feature_columns": list(FEATURE_COLUMNS),
    }
    joblib.dump(bundle, artifact_path, compress=("zlib", 6))
    digest = sha256_file(artifact_path)
    final_meta = {
        **meta,
        "artifact_file": ARTIFACT_NAME,
        "artifact_sha256": digest,
        "artifact_bytes": artifact_path.stat().st_size,
    }
    final_meta["version"] = final_meta["version"].replace("<hash8>", digest[:8])
    (directory / META_NAME).write_text(json.dumps(final_meta, indent=2) + "\n", encoding="utf-8")
    return final_meta


def load_forecaster(directory: Path = ARTIFACT_DIR) -> Forecaster | None:
    """Load and verify the shipped forecaster. Returns None (and logs why) on any problem."""
    artifact_path = directory / ARTIFACT_NAME
    meta_path = directory / META_NAME
    try:
        meta: dict[str, Any] = json.loads(meta_path.read_text(encoding="utf-8"))
        if sha256_file(artifact_path) != meta.get("artifact_sha256"):
            logger.error("model_artifact_hash_mismatch", extra={"artifact": str(artifact_path)})
            return None
        if meta.get("features") != list(FEATURE_COLUMNS):
            logger.error("model_feature_mismatch", extra={"artifact": str(artifact_path)})
            return None
        bundle = joblib.load(artifact_path)
        if bundle.get("format_version") != FORMAT_VERSION or bundle.get("feature_columns") != list(
            FEATURE_COLUMNS
        ):
            logger.error("model_bundle_mismatch", extra={"artifact": str(artifact_path)})
            return None
        label = meta.get("training_data_label")
        if label not in _DATA_LABELS:
            logger.error("model_data_label_invalid", extra={"artifact": str(artifact_path)})
            return None
        interval = meta["interval"]
        return Forecaster(
            estimator=bundle["estimator"],
            algorithm=str(meta["algorithm"]),
            version=str(meta["version"]),
            trained_at=str(meta["trained_at"]),
            training_data_label=cast(DataLabel, label),
            interval=IntervalQuantiles(
                lower_quantile=float(interval["lower_quantile"]),
                upper_quantile=float(interval["upper_quantile"]),
                lower=float(interval["lower"]),
                upper=float(interval["upper"]),
            ),
            meta=meta,
        )
    except Exception as exc:  # any load failure means 'model unavailable', never a crash
        logger.error("model_artifact_unavailable", extra={"error": type(exc).__name__})
        return None
