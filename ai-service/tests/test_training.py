"""Training pipeline pieces: dataset reproducibility, labelling and cleaning."""

from __future__ import annotations

import hashlib
from pathlib import Path

import pandas as pd

from training import data as data_mod
from training.generate_dataset import generate, write_csv

ROOT = Path(__file__).resolve().parent.parent
DATASET = ROOT / "datasets" / "synthetic_restaurant_metrics.csv"


def test_generator_reproduces_shipped_dataset(tmp_path: Path) -> None:
    digest = write_csv(generate(), tmp_path / "regenerated.csv")
    assert digest == hashlib.sha256(DATASET.read_bytes()).hexdigest()
    assert DATASET.stat().st_size < 5 * 1024 * 1024


def test_every_row_is_labelled_synthetic() -> None:
    raw = data_mod.load_raw(DATASET)
    assert set(raw["data_source"].unique()) == {"SYNTHETIC"}
    assert data_mod.training_data_label(raw) == "SYNTHETIC"


def test_label_derivation_never_claims_real_for_synthetic_rows() -> None:
    frame = pd.DataFrame({"data_source": pd.array(["DONOR_ENTERED", "SYNTHETIC"], "string")})
    assert data_mod.training_data_label(frame) == "MIXED"
    real = pd.DataFrame({"data_source": pd.array(["DONOR_ENTERED", "IMPORTED"], "string")})
    assert data_mod.training_data_label(real) == "REAL"
    unknown = pd.DataFrame({"data_source": pd.array([None, "DONOR_ENTERED"], "string")})
    assert data_mod.training_data_label(unknown) == "MIXED"


def test_cleaning_repairs_and_deduplicates() -> None:
    raw = data_mod.load_raw(DATASET)
    cleaned, report = data_mod.clean(raw)
    assert report["duplicates_dropped"] > 0
    assert report["surplus_imputed_from_prepared_minus_sold"] > 0
    assert not cleaned.duplicated(subset=data_mod.KEY).any()
    assert not cleaned[data_mod.QTY].isna().any().any()
    assert (cleaned["sold_qty"] <= cleaned["prepared_qty"]).all()
    assert (cleaned["surplus_qty"] <= cleaned["prepared_qty"]).all()


def test_minimal_real_export_can_be_loaded(tmp_path: Path) -> None:
    """A real export only needs the database columns; descriptive ones are optional."""
    csv = tmp_path / "export.csv"
    csv.write_text(
        "restaurant_id,date,meal_period,prepared_qty,sold_qty,surplus_qty,is_holiday,"
        "data_source\n"
        "donor-1,2026-10-01,LUNCH,200,180,20,false,DONOR_ENTERED\n"
        "donor-1,2026-10-02,LUNCH,210,,25,true,DONOR_ENTERED\n",
        encoding="utf-8",
    )
    raw = data_mod.load_raw(csv)
    assert data_mod.training_data_label(raw) == "REAL"
    assert raw["is_holiday"].tolist() == [False, True]
    cleaned, report = data_mod.clean(raw)
    assert report["sold_imputed_from_prepared_minus_surplus"] == 1
    assert cleaned["sold_qty"].tolist() == [180, 185]
    summary = data_mod.eda_summary(raw)
    assert summary["restaurants_by_type"] == {"UNKNOWN": 1}
