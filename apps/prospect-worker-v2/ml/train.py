"""FadeUp Worker V2 — ML training pipeline.

Trains a template-selection model and registers it. Deliberately does NOT
promote it: promotion is an explicit, documented human decision made
through public.promote_ml_model() from /platform (spec §73).

The phased strategy (spec §31) is enforced here, not merely documented.
With too few labelled outcomes, this script REFUSES to train and records a
`skipped_insufficient_data` run with a reason. That refusal is a correct,
successful outcome — a model fitted on 12 replies would be noise wearing a
ROC-AUC as a disguise, and shipping it would be worse than the
deterministic rules it replaced.

Usage:
    python -m ml.train --target positive_reply --version lr-2026-08-18
    python -m ml.train --target positive_reply --version lr-2026-08-18 --force
"""

from __future__ import annotations

import argparse
import json
import os
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from sklearn.calibration import calibration_curve
from sklearn.dummy import DummyClassifier
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    average_precision_score,
    brier_score_loss,
    log_loss,
    precision_recall_curve,
    roc_auc_score,
)
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from dataset import Dataset, build_dataset, connect, dataset_fingerprint, register_dataset


# ---------------------------------------------------------------------------
# Phase gates
# ---------------------------------------------------------------------------

# Minimums below which supervised learning is not honest.
#
# 200 sent messages and 30 positives is not a rule of thumb pulled from
# the air: with fewer than ~30 positive examples a validation split holds
# single digits of the minority class, and the resulting AUC has a
# confidence interval wide enough to contain "no better than random".
MIN_TOTAL_ROWS = 200
MIN_POSITIVE_LABELS = 30
MIN_NEGATIVE_LABELS = 30
# Below this, a single template dominates and the model would learn "which
# template did we happen to send" rather than "which template works".
MIN_DISTINCT_TEMPLATES = 2


@dataclass
class PhaseVerdict:
    can_train: bool
    phase: str
    reason: str


def assess_phase(dataset: Dataset) -> PhaseVerdict:
    """Decides whether there is enough real data to justify supervised ML."""
    if dataset.row_count == 0:
        return PhaseVerdict(
            False,
            "PHASE_0_RULES",
            "No sent outreach with outcomes exists yet. Deterministic rule-based template "
            "assignment is the correct and only defensible strategy at this point.",
        )

    if dataset.row_count < MIN_TOTAL_ROWS:
        return PhaseVerdict(
            False,
            "PHASE_0_RULES",
            f"Only {dataset.row_count} sent messages with outcomes (need {MIN_TOTAL_ROWS}). "
            "Continue with deterministic rules and start A/B experiments to accumulate labels.",
        )

    if dataset.positive_count < MIN_POSITIVE_LABELS:
        return PhaseVerdict(
            False,
            "PHASE_1_AB_TESTING",
            f"Only {dataset.positive_count} positive outcomes (need {MIN_POSITIVE_LABELS}). "
            "A model fitted here would not generalise. Run controlled A/B experiments instead.",
        )

    if dataset.negative_count < MIN_NEGATIVE_LABELS:
        return PhaseVerdict(
            False,
            "PHASE_1_AB_TESTING",
            f"Only {dataset.negative_count} negative outcomes (need {MIN_NEGATIVE_LABELS}).",
        )

    template_columns = [c for c in dataset.X.columns if str(c).startswith("template_key=")]
    distinct_templates = sum(1 for c in template_columns if dataset.X[c].sum() > 0)
    if distinct_templates < MIN_DISTINCT_TEMPLATES:
        return PhaseVerdict(
            False,
            "PHASE_1_AB_TESTING",
            f"Outcomes cover only {distinct_templates} template(s). A selection model needs "
            "outcomes across at least two templates or it is fitting the send policy, not the effect.",
        )

    return PhaseVerdict(
        True,
        "PHASE_3_SUPERVISED_ML",
        f"{dataset.row_count} rows, {dataset.positive_count} positives across "
        f"{distinct_templates} templates — sufficient for a supervised baseline.",
    )


# ---------------------------------------------------------------------------
# Metrics
# ---------------------------------------------------------------------------


def evaluate(y_true: np.ndarray, y_prob: np.ndarray) -> dict[str, float]:
    """The metric set that actually describes a low-base-rate ranking problem.

    Accuracy is deliberately absent (spec §35). With a 4% reply rate a
    model that predicts "never replies" scores 96% accuracy and is
    completely useless. PR-AUC and lift are what matter when the positive
    class is rare and the model's job is ranking.
    """
    metrics: dict[str, float] = {}

    # A degenerate split (one class only) makes most metrics undefined.
    if len(np.unique(y_true)) < 2:
        return {"undefined_single_class": 1.0}

    metrics["roc_auc"] = float(roc_auc_score(y_true, y_prob))
    metrics["pr_auc"] = float(average_precision_score(y_true, y_prob))
    metrics["log_loss"] = float(log_loss(y_true, y_prob, labels=[0, 1]))
    # Calibration: are predicted probabilities believable as probabilities?
    metrics["brier_score"] = float(brier_score_loss(y_true, y_prob))

    base_rate = float(y_true.mean())
    metrics["base_rate"] = base_rate

    # Lift at the top decile — the number that answers "if we only message
    # the top 10% the model likes, how much better than random is that?"
    metrics["lift_at_10pct"] = _lift_at_k(y_true, y_prob, 0.10, base_rate)
    metrics["lift_at_20pct"] = _lift_at_k(y_true, y_prob, 0.20, base_rate)

    precision, recall, _ = precision_recall_curve(y_true, y_prob)
    # Precision at the recall level where half the positives are captured.
    with np.errstate(invalid="ignore"):
        idx = np.argmin(np.abs(recall - 0.5))
    metrics["precision_at_50pct_recall"] = float(precision[idx])

    # Calibration error over 5 bins (10 is too many at this sample size).
    try:
        prob_true, prob_pred = calibration_curve(y_true, y_prob, n_bins=5, strategy="quantile")
        metrics["calibration_mae"] = float(np.mean(np.abs(prob_true - prob_pred)))
    except ValueError:
        # Not enough distinct predictions to form bins.
        metrics["calibration_mae"] = float("nan")

    return metrics


def _lift_at_k(y_true: np.ndarray, y_prob: np.ndarray, k: float, base_rate: float) -> float:
    if base_rate <= 0:
        return float("nan")
    n = max(1, int(len(y_prob) * k))
    top_indices = np.argsort(-y_prob)[:n]
    return float(y_true[top_indices].mean() / base_rate)


# ---------------------------------------------------------------------------
# Training
# ---------------------------------------------------------------------------


@dataclass
class TrainingOutcome:
    trained: bool
    phase: str
    reason: str
    model_type: str | None = None
    train_rows: int = 0
    validation_rows: int = 0
    train_metrics: dict[str, float] | None = None
    validation_metrics: dict[str, float] | None = None
    baseline_metrics: dict[str, float] | None = None
    artifact_path: str | None = None
    beats_baseline: bool = False


def train_model(
    dataset: Dataset,
    *,
    model_type: str,
    artifact_dir: Path,
    model_key: str,
    model_version: str,
    test_size: float = 0.25,
) -> TrainingOutcome:
    """Fits, evaluates against a baseline, and exports the artifact."""
    verdict = assess_phase(dataset)
    if not verdict.can_train:
        return TrainingOutcome(trained=False, phase=verdict.phase, reason=verdict.reason)

    X = dataset.X
    y = dataset.y.to_numpy()

    # Stratified split so the rare positive class is represented in both
    # halves; seeded so the split is reproducible.
    X_train, X_valid, y_train, y_valid = train_test_split(
        X, y, test_size=test_size, random_state=dataset.random_seed, stratify=y
    )

    if model_type == "logistic_regression":
        pipeline = Pipeline(
            [
                # Median imputation for NaN (our UNKNOWN encoding). The
                # imputed values are exported alongside the coefficients so
                # inference reproduces training exactly.
                ("impute", SimpleImputer(strategy="median")),
                ("scale", StandardScaler()),
                (
                    "model",
                    LogisticRegression(
                        max_iter=2000,
                        # Class imbalance is the norm here: reply rates on
                        # cold outreach are single digits.
                        class_weight="balanced",
                        random_state=dataset.random_seed,
                        # L2 with modest regularisation — the feature count
                        # is comparable to the sample size at this scale.
                        C=0.5,
                    ),
                ),
            ]
        )
    elif model_type == "gradient_boosted_trees":
        pipeline = Pipeline(
            [
                # HistGradientBoosting handles NaN natively, so UNKNOWN
                # stays a distinct signal rather than being imputed away.
                (
                    "model",
                    HistGradientBoostingClassifier(
                        max_iter=200,
                        max_depth=4,
                        learning_rate=0.05,
                        random_state=dataset.random_seed,
                    ),
                ),
            ]
        )
    else:
        raise ValueError(f"unsupported model_type {model_type!r}")

    pipeline.fit(X_train, y_train)

    train_prob = pipeline.predict_proba(X_train)[:, 1]
    valid_prob = pipeline.predict_proba(X_valid)[:, 1]

    train_metrics = evaluate(y_train, train_prob)
    validation_metrics = evaluate(y_valid, valid_prob)

    # The baseline every model must beat to be worth considering: predict
    # the base rate for everyone. Reporting a model's AUC without this is
    # how meaningless models get promoted.
    baseline = DummyClassifier(strategy="prior", random_state=dataset.random_seed)
    baseline.fit(X_train, y_train)
    baseline_metrics = evaluate(y_valid, baseline.predict_proba(X_valid)[:, 1])

    beats_baseline = validation_metrics.get("pr_auc", 0.0) > baseline_metrics.get("pr_auc", 0.0) * 1.05

    artifact_path: str | None = None
    if model_type == "logistic_regression":
        artifact_dir.mkdir(parents=True, exist_ok=True)
        artifact_path = str(artifact_dir / f"{model_key}-{model_version}.json")
        export_logistic_artifact(
            pipeline,
            dataset=dataset,
            model_key=model_key,
            model_version=model_version,
            path=Path(artifact_path),
        )

    return TrainingOutcome(
        trained=True,
        phase=verdict.phase,
        reason=verdict.reason,
        model_type=model_type,
        train_rows=len(X_train),
        validation_rows=len(X_valid),
        train_metrics=train_metrics,
        validation_metrics=validation_metrics,
        baseline_metrics=baseline_metrics,
        artifact_path=artifact_path,
        beats_baseline=beats_baseline,
    )


def export_logistic_artifact(
    pipeline: Pipeline,
    *,
    dataset: Dataset,
    model_key: str,
    model_version: str,
    path: Path,
) -> None:
    """Exports coefficients as plain JSON — never a pickle.

    The Worker loads this at inference time. Unpickling a Python object in
    the Worker process would be arbitrary code execution by design; a JSON
    coefficient vector cannot execute anything. It also means inference
    needs no Python runtime at all (see src/ml/inference.ts).
    """
    imputer: SimpleImputer = pipeline.named_steps["impute"]
    scaler: StandardScaler = pipeline.named_steps["scale"]
    model: LogisticRegression = pipeline.named_steps["model"]

    artifact = {
        "modelKey": model_key,
        "modelVersion": model_version,
        "modelType": "logistic_regression",
        "target": dataset.target,
        "featureSchemaVersion": dataset.feature_schema_version,
        "featureNames": [str(c) for c in dataset.X.columns],
        "coefficients": [float(v) for v in model.coef_[0]],
        "intercept": float(model.intercept_[0]),
        "featureMeans": [float(v) for v in scaler.mean_],
        "featureScales": [float(v) for v in scaler.scale_],
        "featureImputations": [float(v) for v in imputer.statistics_],
        "trainedAt": datetime.now(timezone.utc).isoformat(),
        "datasetVersion": dataset.version,
        "datasetFingerprint": dataset_fingerprint(dataset),
        "randomSeed": dataset.random_seed,
    }

    path.write_text(json.dumps(artifact, indent=2), encoding="utf-8")


def artifact_sha256(path: Path) -> str:
    import hashlib

    return hashlib.sha256(path.read_bytes()).hexdigest()


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------


def register_training_run(conn, dataset: Dataset, outcome: TrainingOutcome, *, model_key: str, model_version: str) -> None:
    """Records the run and, when a model was fitted, the (INACTIVE) model version."""
    model_version_id: str | None = None

    with conn.cursor() as cur:
        if outcome.trained:
            sha = artifact_sha256(Path(outcome.artifact_path)) if outcome.artifact_path else None
            cur.execute(
                """
                insert into public.ml_model_versions
                    (model_key, model_version, model_type, target, feature_schema_version,
                     training_dataset_version, hyperparameters, metrics, artifact_path,
                     artifact_sha256, random_seed, is_active)
                values (%s, %s, %s, %s::public.ml_model_target, %s, %s, %s, %s, %s, %s, %s, false)
                on conflict (model_key, model_version) do update
                set metrics = excluded.metrics,
                    artifact_path = excluded.artifact_path,
                    artifact_sha256 = excluded.artifact_sha256
                returning id
                """,
                (
                    model_key,
                    model_version,
                    outcome.model_type,
                    dataset.target,
                    dataset.feature_schema_version,
                    dataset.version,
                    json.dumps({"model_type": outcome.model_type, "random_seed": dataset.random_seed}),
                    json.dumps(outcome.validation_metrics or {}),
                    outcome.artifact_path,
                    sha,
                    dataset.random_seed,
                ),
            )
            row = cur.fetchone()
            model_version_id = row[0] if row else None

        cur.execute(
            """
            insert into public.ml_training_runs
                (model_version_id, dataset_version, status, skip_reason, train_rows, validation_rows,
                 train_metrics, validation_metrics, baseline_metrics, leakage_check_passed,
                 finished_at, log_excerpt)
            values (%s, %s, %s, %s, %s, %s, %s, %s, %s, true, now(), %s)
            """,
            (
                model_version_id,
                dataset.version if dataset.row_count else None,
                "completed" if outcome.trained else "skipped_insufficient_data",
                None if outcome.trained else outcome.reason,
                outcome.train_rows,
                outcome.validation_rows,
                json.dumps(outcome.train_metrics or {}),
                json.dumps(outcome.validation_metrics or {}),
                json.dumps(outcome.baseline_metrics or {}),
                f"phase={outcome.phase}; beats_baseline={outcome.beats_baseline}; {outcome.reason}"[:2000],
            ),
        )

    conn.commit()


def main() -> int:
    parser = argparse.ArgumentParser(description="Train a FadeUp template-selection model")
    parser.add_argument("--target", default="positive_reply")
    parser.add_argument("--version", required=True, help="model version label, e.g. lr-2026-08-18")
    parser.add_argument("--model-key", default="template_selector")
    parser.add_argument(
        "--model-type",
        default="logistic_regression",
        choices=["logistic_regression", "gradient_boosted_trees"],
    )
    parser.add_argument("--dataset-version", default=None)
    parser.add_argument("--feature-schema", default="fs-v1")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--artifact-dir", default=os.environ.get("ML_ARTIFACT_DIR", "/app/ml-artifacts"))
    parser.add_argument(
        "--force",
        action="store_true",
        help="train even when the phase gate says there is not enough data (for testing only)",
    )
    args = parser.parse_args()

    dataset_version = args.dataset_version or f"ds-{datetime.now(timezone.utc):%Y%m%d-%H%M%S}"

    conn = connect()
    try:
        dataset = build_dataset(
            conn,
            target=args.target,
            version=dataset_version,
            feature_schema_version=args.feature_schema,
            random_seed=args.seed,
        )

        print(f"dataset {dataset.version}: {dataset.row_count} rows, {dataset.positive_count} positive")

        if dataset.row_count:
            register_dataset(conn, dataset)

        verdict = assess_phase(dataset)
        print(f"phase: {verdict.phase}")
        print(f"  {verdict.reason}")

        if not verdict.can_train and not args.force:
            outcome = TrainingOutcome(trained=False, phase=verdict.phase, reason=verdict.reason)
            register_training_run(conn, dataset, outcome, model_key=args.model_key, model_version=args.version)
            print("\nNo model trained. This is the correct outcome — the deterministic rule")
            print("selector remains in use and outreach is unaffected.")
            return 0

        outcome = train_model(
            dataset,
            model_type=args.model_type,
            artifact_dir=Path(args.artifact_dir),
            model_key=args.model_key,
            model_version=args.version,
        )

        register_training_run(conn, dataset, outcome, model_key=args.model_key, model_version=args.version)

        print(f"\nmodel:      {args.model_key}:{args.version} ({outcome.model_type})")
        print(f"train rows: {outcome.train_rows}   validation rows: {outcome.validation_rows}")
        print("\nvalidation metrics:")
        for key, value in sorted((outcome.validation_metrics or {}).items()):
            print(f"  {key:28s} {value:.4f}")
        print("\nbaseline (predict base rate):")
        for key, value in sorted((outcome.baseline_metrics or {}).items()):
            print(f"  {key:28s} {value:.4f}")
        print(f"\nbeats baseline PR-AUC by >5%: {outcome.beats_baseline}")
        print(f"artifact: {outcome.artifact_path}")
        print("\nThe model is registered but NOT active. Review the metrics above, then promote")
        print("deliberately from /platform (Data Science -> Models), which records who promoted")
        print("it and why. Nothing uses this model until then.")
    finally:
        conn.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
