"""Summarize explicit beta observations; unknowns never become passes or zeros."""
import argparse
import csv
import json
import math
from collections import Counter
from pathlib import Path
from statistics import median

ROOT = Path(__file__).resolve().parents[1]


def rows_from(path, required):
    with Path(path).open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        if not required.issubset(reader.fieldnames or []):
            raise ValueError(f"{Path(path).name}: missing required CSV columns")
        rows = list(reader)
    for row in rows:
        if None in row or any(value is None for value in row.values()):
            raise ValueError(f"{Path(path).name}: malformed CSV row")
    return rows


def number(row, key, integer=False, maximum=None):
    raw = row.get(key, "").strip()
    if not raw:
        return None
    try:
        value = float(raw)
    except ValueError as error:
        raise ValueError(f"{row.get('run_id', 'row')}: invalid {key}") from error
    if not math.isfinite(value) or value < 0 or (integer and not value.is_integer()) or (maximum is not None and value > maximum):
        raise ValueError(f"{row.get('run_id', 'row')}: invalid {key}")
    return int(value) if integer else value


def boolean(row, key):
    raw = row.get(key, "").strip().lower()
    if not raw:
        return None
    if raw not in ("true", "false", "1", "0", "yes", "no"):
        raise ValueError(f"{row.get('run_id', 'row')}: {key} must be true, false or blank")
    return raw in ("true", "1", "yes")


def classify(row):
    kind = row.get("observation_kind", "").strip()
    if kind and kind not in ("catalog", "playback", "unavailable"):
        raise ValueError(f"{row.get('run_id', 'row')}: invalid observation_kind")
    if kind == "unavailable" or row.get("error_category", "").strip() == "platform-unavailable":
        return "unavailable"
    if kind == "catalog" or (not kind and not row.get("platform", "").strip()):
        return "catalog"
    # Legacy rows with a platform are eligible observations, never automatic passes.
    return "playback"


def fraction(numerator, denominator):
    return {"numerator": numerator, "denominator": denominator, "fraction": numerator / denominator if denominator else None}


def summarize(rows):
    kinds = Counter(classify(row) for row in rows)
    playback = [row for row in rows if classify(row) == "playback"]
    wrong = selections = synced = sync_assessed = anchors_assessed = 0
    needed = translated = translation_runs = 0
    network = duplicate = network_runs = 0
    identical = duplicate_transforms = concurrency_runs = 0
    visibility_failures = visibility_assessed = 0
    readable = []; completed = []; pronunciation = []; meaning = []; timing_medians = []; timing_maxima = []
    errors = Counter()
    for row in playback:
        correct = boolean(row, "correct_recording")
        timed = boolean(row, "genuine_synced")
        if correct is not None:
            selections += 1; wrong += int(not correct)
        anchors = number(row, "timing_anchors", integer=True)
        timing_median = number(row, "median_timing_error_seconds")
        timing_max = number(row, "max_timing_error_seconds")
        if timing_median is not None and timing_max is not None and timing_median > timing_max:
            raise ValueError(f"{row['run_id']}: median timing error exceeds maximum")
        assessed_timing = anchors is not None and anchors >= 3 and timing_median is not None and timing_max is not None
        if correct is True and timed is not None and (timed is False or assessed_timing):
            sync_assessed += 1; synced += int(timed)
        if correct is True and timed is True and assessed_timing:
            anchors_assessed += 1; timing_medians.append(timing_median); timing_maxima.append(timing_max)
        source = number(row, "source_lines", integer=True)
        required = number(row, "translation_required_lines", integer=True)
        meaningful = number(row, "meaningful_translated_lines", integer=True)
        if required is not None and source is not None and required > source:
            raise ValueError(f"{row['run_id']}: translation requirement exceeds source lines")
        if required is not None and meaningful is not None:
            if meaningful > required:
                raise ValueError(f"{row['run_id']}: translated lines exceed required lines")
            needed += required; translated += meaningful; translation_runs += 1
        requests = number(row, "network_requests", integer=True)
        duplicates = number(row, "duplicate_requests", integer=True)
        if requests is not None and duplicates is not None:
            if duplicates > requests:
                raise ValueError(f"{row['run_id']}: duplicate requests exceed requests")
            network += requests; duplicate += duplicates; network_runs += 1
        transforms = number(row, "identical_transform_requests", integer=True)
        repeated = number(row, "duplicate_transform_requests", integer=True)
        if transforms is not None and repeated is not None:
            if repeated > transforms:
                raise ValueError(f"{row['run_id']}: duplicate transformations exceed attempts")
            identical += transforms; duplicate_transforms += repeated; concurrency_runs += 1
        visible = boolean(row, "visibility_failure")
        if visible is not None:
            visibility_assessed += 1; visibility_failures += int(visible)
        for key, target in [("first_readable_ms", readable), ("completed_ms", completed)]:
            value = number(row, key)
            if value is not None:
                target.append(value)
        for key, target in [("pronunciation_score_1_to_5", pronunciation), ("meaning_score_1_to_5", meaning)]:
            value = number(row, key, integer=True, maximum=5)
            if value is not None and value < 1:
                raise ValueError(f"{row['run_id']}: {key} must be 1 to 5")
            if value is not None and row.get("fluent_reviewer", "").strip():
                target.append(value)
        if row.get("error_category", "").strip():
            errors[row["error_category"].strip()] += 1
    return {
        "observations": len(rows), "playback_runs": len(playback), "catalog_only": kinds["catalog"], "unavailable": kinds["unavailable"],
        "wrong_recording_rate": fraction(wrong, selections),
        "audibly_assessed_sync_coverage": fraction(synced, sync_assessed),
        "unassessed_sync_runs": sum(boolean(row, "correct_recording") is True for row in playback) - sync_assessed,
        "timing": {"assessed_runs": anchors_assessed, "median_of_run_medians_seconds": median(timing_medians) if timing_medians else None, "worst_error_seconds": max(timing_maxima) if timing_maxima else None},
        "translation_completeness": {**fraction(translated, needed), "assessed_runs": translation_runs},
        "duplicate_network_request_share": {**fraction(duplicate, network), "assessed_runs": network_runs},
        "duplicate_transform_rate": {**fraction(duplicate_transforms, identical), "assessed_runs": concurrency_runs},
        "visibility_failure_rate": fraction(visibility_failures, visibility_assessed),
        "first_readable_ms": {"assessed_runs": len(readable), "median": median(readable) if readable else None},
        "completed_ms": {"assessed_runs": len(completed), "median": median(completed) if completed else None},
        "fluent_scores": {"pronunciation_reviews": len(pronunciation), "pronunciation_median": median(pronunciation) if pronunciation else None, "meaning_reviews": len(meaning), "meaning_median": median(meaning) if meaning else None},
        "errors": dict(sorted(errors.items())),
    }


def make_report(observations, corpus):
    seen = set()
    for row in observations:
        run_id = row.get("run_id", "").strip()
        if not run_id or run_id in seen:
            raise ValueError("Observation IDs must be present and unique")
        seen.add(run_id)
    dimensions = {}
    for field in ("language", "platform", "provider"):
        groups = {}
        for row in observations:
            groups.setdefault(row.get(field, "").strip() or "unrecorded", []).append(row)
        dimensions[field] = {key: summarize(value) for key, value in sorted(groups.items())}
    filled = sum(all(row.get(key, "").strip() for key in ("platform", "media_id", "title", "credited_artists", "duration_seconds")) for row in corpus)
    reviewed = sum(row.get("review_status", "").strip() == "reviewed" for row in corpus)
    return {"overall": summarize(observations), "by": dimensions,
            "corpus": {"slots": len(corpus), "filled_metadata_slots": filled, "marked_reviewed_slots": reviewed},
            "notes": ["Catalog and unavailable runs are excluded from playback metrics.", "Blank or unreviewed values remain unmeasured; zero denominators produce null.", "Synced coverage requires a confirmed recording and three audible timing anchors for positive claims.", "This report does not certify a release or infer language support."]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--observations", type=Path, default=ROOT / "docs/beta-observations.csv")
    parser.add_argument("--corpus", type=Path, default=ROOT / "docs/beta-corpus.csv")
    args = parser.parse_args()
    try:
        observations = rows_from(args.observations, {"run_id", "platform", "language", "correct_recording", "genuine_synced"})
        corpus = rows_from(args.corpus, {"slot", "language", "review_status"})
        print(json.dumps(make_report(observations, corpus), ensure_ascii=False, indent=2, allow_nan=False))
    except (OSError, ValueError) as error:
        parser.exit(2, f"Beta report: {error}\n")


if __name__ == "__main__":
    main()
