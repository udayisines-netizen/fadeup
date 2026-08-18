"""FadeUp Worker V2 — ML training dataset builder.

Builds a versioned, reproducible, leakage-free training matrix from the
acquisition schema.

The single most important property of this module is what it REFUSES to
put in the matrix. `positive_reply` is the label; `replied`, `delivered`,
`read`, `converted_at` and everything else that only exists AFTER the
message went out are forbidden features. `assert_no_leakage()` enforces
that mechanically against public.ml_feature_schemas.forbidden_features,
so the guard cannot rot as features are added.

Usage:
    python -m ml.dataset --target positive_reply --version ds-2026-08-18
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import numpy as np
import pandas as pd
import psycopg2
import psycopg2.extras


# ---------------------------------------------------------------------------
# Connection
# ---------------------------------------------------------------------------


def connect():
    """Connects using the same DB_* variables the Worker uses.

    Reads from the environment only — no credential ever appears in this
    file, in a default, or in a log line.
    """
    return psycopg2.connect(
        host=os.environ["DB_HOST"],
        port=int(os.environ.get("DB_PORT", "5432")),
        dbname=os.environ["DB_NAME"],
        user=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"],
        sslmode="require" if os.environ.get("DB_SSL", "false").lower() == "true" else "prefer",
    )


# ---------------------------------------------------------------------------
# Feature/label extraction
# ---------------------------------------------------------------------------

# One row per SENT recipient. A recipient that was never sent has no
# outcome and cannot be a training example — including them would train the
# model on the eligibility gate rather than on message effectiveness.
#
# Every selected column is observable at the moment the template decision
# was made. The three outcome columns at the end are LABELS, split off
# immediately in build_dataset() and never allowed into X.
EXTRACT_SQL = """
select
    r.id                                as recipient_id,
    r.prospect_id,
    r.campaign_id,
    r.template_id,

    -- ---- features: location -------------------------------------------
    p.country,
    pl.region,
    pl.city,

    -- ---- features: business -------------------------------------------
    p.type::text                        as shop_type,
    p.rating,
    p.review_count,
    p.estimated_barber_count,

    -- ---- features: FadeUp scores (computed pre-send) -------------------
    p.fadeup_fit_score,
    p.migration_potential_score,

    -- ---- features: competitor ------------------------------------------
    coalesce(bp.key, 'UNKNOWN')         as booking_provider,
    case
        when o.first_seen_at is not null and bp.key not in ('NO_BOOKING', 'UNKNOWN')
        -- Tenure AS OF THE SEND, not as of today: using today's date would
        -- leak information from after the prediction moment.
        then extract(epoch from (r.sent_at - o.first_seen_at)) / 86400.0
    end                                 as competitor_tenure_days,

    -- ---- features: digital (from the versioned feature store) ----------
    f.has_website,
    f.mobile_ready,
    f.booking_detected,
    f.instagram_presence,
    f.multi_barber,
    f.website_quality_score,
    f.digital_gap_score,

    -- ---- features: outreach decision -----------------------------------
    t.key                               as template_key,
    coalesce(r.sales_angle, 'UNKNOWN')  as sales_angle,
    r.locale,
    extract(dow from r.sent_at)         as send_weekday,
    extract(hour from r.sent_at)        as send_hour,

    -- ---- LABELS (never features) ---------------------------------------
    (r.replied_at is not null)                              as label_reply,
    (r.state = 'positive_reply')                            as label_positive_reply,
    (r.state in ('claimed', 'activated', 'paid'))           as label_claim,
    (r.state in ('activated', 'paid'))                      as label_activated,
    (r.state = 'paid')                                      as label_paid,

    r.sent_at
from public.outreach_recipients r
join public.prospects p           on p.id = r.prospect_id
join public.outreach_templates t  on t.id = r.template_id
left join public.prospect_locations pl on pl.prospect_id = p.id and pl.is_primary
left join public.booking_providers bp  on bp.id = p.current_booking_provider_id
left join public.booking_provider_observations o
       on o.prospect_id = p.id and o.provider_id = p.current_booking_provider_id and o.is_current
left join lateral (
    select
        max(case when pf.feature_key = 'has_website'           then pf.value_bool::text end) as has_website,
        max(case when pf.feature_key = 'mobile_ready'          then pf.value_bool::text end) as mobile_ready,
        max(case when pf.feature_key = 'booking_detected'      then pf.value_bool::text end) as booking_detected,
        max(case when pf.feature_key = 'instagram_presence'    then pf.value_bool::text end) as instagram_presence,
        max(case when pf.feature_key = 'multi_barber'          then pf.value_bool::text end) as multi_barber,
        max(case when pf.feature_key = 'website_quality_score' then pf.value_numeric end)    as website_quality_score,
        max(case when pf.feature_key = 'digital_gap_score'     then pf.value_numeric end)    as digital_gap_score
    from public.prospect_features pf
    where pf.prospect_id = p.id and pf.feature_version = 'v1'
) f on true
where r.sent_at is not null
  and (%(snapshot_from)s::timestamptz is null or r.sent_at >= %(snapshot_from)s::timestamptz)
  and r.sent_at <= %(snapshot_to)s::timestamptz
order by r.sent_at
"""


LABEL_COLUMNS = [
    "label_reply",
    "label_positive_reply",
    "label_claim",
    "label_activated",
    "label_paid",
]

# Columns that identify a row but must never be modelled.
IDENTIFIER_COLUMNS = ["recipient_id", "prospect_id", "campaign_id", "template_id", "sent_at"]

TRIBOOL_COLUMNS = [
    "has_website",
    "mobile_ready",
    "booking_detected",
    "instagram_presence",
    "multi_barber",
]

NUMERIC_COLUMNS = [
    "rating",
    "review_count",
    "estimated_barber_count",
    "fadeup_fit_score",
    "migration_potential_score",
    "competitor_tenure_days",
    "website_quality_score",
    "digital_gap_score",
    "send_hour",
]

CATEGORICAL_COLUMNS = [
    "country",
    "shop_type",
    "booking_provider",
    "template_key",
    "sales_angle",
    "locale",
    "send_weekday",
]


class LeakageError(RuntimeError):
    """Raised when a forbidden, post-outcome column reaches the feature matrix."""


@dataclass
class Dataset:
    version: str
    target: str
    feature_schema_version: str
    X: pd.DataFrame
    y: pd.Series
    identifiers: pd.DataFrame
    snapshot_from: datetime | None
    snapshot_to: datetime
    random_seed: int
    feature_coverage: dict[str, float] = field(default_factory=dict)
    label_distribution: dict[str, int] = field(default_factory=dict)

    @property
    def row_count(self) -> int:
        return len(self.X)

    @property
    def positive_count(self) -> int:
        return int(self.y.sum())

    @property
    def negative_count(self) -> int:
        return int(len(self.y) - self.y.sum())


def tribool_to_float(value: Any) -> float:
    """TRUE -> 1.0, FALSE -> 0.0, UNKNOWN/NOT_APPLICABLE/None -> NaN.

    This is the Python half of the tri-state contract; it must stay
    identical to toModelValue() in src/features/tribool.ts, or the model
    sees a different feature space online than it learned offline.
    """
    if value == "TRUE":
        return 1.0
    if value == "FALSE":
        return 0.0
    return float("nan")


def fetch_forbidden_features(conn, feature_schema_version: str) -> list[str]:
    """Reads the leakage denylist from the database, so it is versioned with the schema."""
    with conn.cursor() as cur:
        cur.execute(
            "select forbidden_features from public.ml_feature_schemas where version = %s",
            (feature_schema_version,),
        )
        row = cur.fetchone()
    return list(row[0]) if row else []


def assert_no_leakage(X: pd.DataFrame, forbidden: list[str]) -> None:
    """Fails loudly if any forbidden column, or a one-hot derived from one, is present.

    Checked on the ENCODED matrix, because one-hot encoding turns
    `replied` into `replied=True` and a naive exact-name check would miss
    it.
    """
    violations: list[str] = []
    for column in X.columns:
        base = str(column).split("=", 1)[0]
        if base in forbidden or str(column) in forbidden:
            violations.append(str(column))
        # Any column whose name mentions an outcome is suspicious even if
        # it is not on the explicit list.
        lowered = str(column).lower()
        if any(token in lowered for token in ("replied", "delivered", "read_at", "converted", "activated", "paid")):
            if str(column) not in violations:
                violations.append(str(column))

    if violations:
        raise LeakageError(
            "data leakage: these post-outcome columns reached the feature matrix: " + ", ".join(sorted(violations))
        )


def encode_features(df: pd.DataFrame) -> pd.DataFrame:
    """Builds the numeric design matrix.

    Categoricals become `name=value` indicator columns — exactly the naming
    buildFeatureMap() uses in src/ml/inference.ts, so a coefficient
    exported here is applied to the same feature at inference time.
    """
    frames: list[pd.DataFrame] = []

    numeric = pd.DataFrame(index=df.index)
    for column in NUMERIC_COLUMNS:
        if column in df.columns:
            numeric[column] = pd.to_numeric(df[column], errors="coerce")
    frames.append(numeric)

    tribools = pd.DataFrame(index=df.index)
    for column in TRIBOOL_COLUMNS:
        if column in df.columns:
            tribools[column] = df[column].map(tribool_to_float).astype(float)
    frames.append(tribools)

    for column in CATEGORICAL_COLUMNS:
        if column not in df.columns:
            continue
        values = df[column].fillna("UNKNOWN").astype(str)
        dummies = pd.get_dummies(values, prefix=column, prefix_sep="=", dtype=float)
        frames.append(dummies)

    X = pd.concat(frames, axis=1)
    # Deterministic column order, so two runs over the same data produce
    # byte-identical artifacts.
    return X.reindex(sorted(X.columns), axis=1)


def build_dataset(
    conn,
    *,
    target: str,
    version: str,
    feature_schema_version: str = "fs-v1",
    snapshot_from: datetime | None = None,
    snapshot_to: datetime | None = None,
    random_seed: int = 42,
) -> Dataset:
    """Extracts, encodes, and leakage-checks the training matrix."""
    label_column = f"label_{target}"
    if label_column not in LABEL_COLUMNS:
        raise ValueError(f"unsupported target {target!r}; expected one of {[c[6:] for c in LABEL_COLUMNS]}")

    snapshot_to = snapshot_to or datetime.now(timezone.utc)

    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(EXTRACT_SQL, {"snapshot_from": snapshot_from, "snapshot_to": snapshot_to})
        rows = cur.fetchall()

    df = pd.DataFrame([dict(r) for r in rows])

    if df.empty:
        return Dataset(
            version=version,
            target=target,
            feature_schema_version=feature_schema_version,
            X=pd.DataFrame(),
            y=pd.Series(dtype=float),
            identifiers=pd.DataFrame(),
            snapshot_from=snapshot_from,
            snapshot_to=snapshot_to,
            random_seed=random_seed,
        )

    y = df[label_column].astype(int)
    identifiers = df[[c for c in IDENTIFIER_COLUMNS if c in df.columns]].copy()

    # Drop EVERY label and identifier before encoding. This is the
    # structural guarantee; assert_no_leakage() is the belt-and-braces
    # check that catches anything reintroduced by mistake.
    feature_df = df.drop(columns=[c for c in LABEL_COLUMNS + IDENTIFIER_COLUMNS if c in df.columns])

    X = encode_features(feature_df)

    forbidden = fetch_forbidden_features(conn, feature_schema_version)
    assert_no_leakage(X, forbidden)

    coverage = {
        str(column): float(1.0 - X[column].isna().mean()) for column in X.columns
    }
    label_distribution = {
        str(name): int(count) for name, count in y.value_counts().items()
    }

    return Dataset(
        version=version,
        target=target,
        feature_schema_version=feature_schema_version,
        X=X,
        y=y,
        identifiers=identifiers,
        snapshot_from=snapshot_from,
        snapshot_to=snapshot_to,
        random_seed=random_seed,
        feature_coverage=coverage,
        label_distribution=label_distribution,
    )


def register_dataset(conn, dataset: Dataset) -> None:
    """Records the dataset in public.ml_datasets so a training run is reproducible."""
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into public.ml_datasets
                (version, feature_schema_version, target, row_count, positive_count, negative_count,
                 snapshot_from, snapshot_to, feature_coverage, label_distribution, random_seed)
            values (%s, %s, %s::public.ml_model_target, %s, %s, %s, %s, %s, %s, %s, %s)
            on conflict (version) do update
            set row_count = excluded.row_count,
                positive_count = excluded.positive_count,
                negative_count = excluded.negative_count,
                feature_coverage = excluded.feature_coverage,
                label_distribution = excluded.label_distribution
            """,
            (
                dataset.version,
                dataset.feature_schema_version,
                dataset.target,
                dataset.row_count,
                dataset.positive_count,
                dataset.negative_count,
                dataset.snapshot_from,
                dataset.snapshot_to,
                json.dumps(dataset.feature_coverage),
                json.dumps(dataset.label_distribution),
                dataset.random_seed,
            ),
        )
    conn.commit()


def dataset_fingerprint(dataset: Dataset) -> str:
    """A content hash of the matrix, so two runs claiming the same version can be compared."""
    hasher = hashlib.sha256()
    hasher.update(dataset.target.encode())
    hasher.update(",".join(map(str, dataset.X.columns)).encode())
    hasher.update(np.ascontiguousarray(dataset.X.to_numpy(dtype=float, na_value=np.nan)).tobytes())
    hasher.update(np.ascontiguousarray(dataset.y.to_numpy(dtype=float)).tobytes())
    return hasher.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description="Build a FadeUp acquisition ML dataset")
    parser.add_argument("--target", default="positive_reply", help="reply | positive_reply | claim | activated | paid")
    parser.add_argument("--version", required=True, help="dataset version label, e.g. ds-2026-08-18")
    parser.add_argument("--feature-schema", default="fs-v1")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--register", action="store_true", help="record the dataset in public.ml_datasets")
    args = parser.parse_args()

    conn = connect()
    try:
        dataset = build_dataset(
            conn,
            target=args.target,
            version=args.version,
            feature_schema_version=args.feature_schema,
            random_seed=args.seed,
        )

        print(f"target:      {dataset.target}")
        print(f"rows:        {dataset.row_count}")
        print(f"positives:   {dataset.positive_count}")
        print(f"negatives:   {dataset.negative_count}")
        print(f"features:    {len(dataset.X.columns)}")
        if dataset.row_count:
            print(f"fingerprint: {dataset_fingerprint(dataset)[:16]}")

        if args.register and dataset.row_count:
            register_dataset(conn, dataset)
            print(f"registered as {dataset.version}")
    finally:
        conn.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
