"""
Hostel aspect ratings with TypeSafe Jev, using the "Rate" framing evaluated in the author's
bachelor thesis.

One Jev call per hostel asks one Score question per aspect over the hostel's
newest Hostelworld reviews. Each answer is a level index on a 10-level scale,
mapped to 0..1, then passed through a per-aspect linear calibration fitted
against Hostelworld guest sub-scores (see rating_calibration.json and
calibrate_ratings.py). Aspects without a guest sub-score (bathrooms, party,
social) are returned uncalibrated.
"""
import json
import os
import re
import time

import requests
from psycopg.types.json import Jsonb

from app import config, db

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

# Pinned: the calibration is only valid for the model version it was fitted on.
RATING_MODEL = "typesafe/jev-1.13"
REVIEW_CHAR_LIMIT = 110_000
CALIBRATION_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rating_calibration.json")

ASPECTS = [
    "security", "location", "staff", "atmosphere", "cleanliness", "facilities",
    "value_for_money", "overall", "bathrooms", "party", "social",
]
ASPECT_NOTES = {"atmosphere": "Generally interpreted as party / social atmosphere."}

# Ten ordered levels (the maximum Jev allows) spanning 0.00-1.00.
LEVELS = [
    "Terrible: the reviews put this aspect at the very bottom of the scale (about 0.00 of 1.00)",
    "Very poor (about 0.11 of 1.00)",
    "Poor (about 0.22 of 1.00)",
    "Below average (about 0.33 of 1.00)",
    "Mediocre (about 0.44 of 1.00)",
    "Fair, acceptable (about 0.56 of 1.00)",
    "Good (about 0.67 of 1.00)",
    "Very good (about 0.78 of 1.00)",
    "Excellent (about 0.89 of 1.00)",
    "Outstanding: the reviews put this aspect at the top of the scale (1.00 of 1.00)",
]

_RE_EMAIL = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
_RE_HANDLE = re.compile(r"(?<!\w)@[\w_.-]{2,}")


# ── Inputs ──────────────────────────────────────────────────────────────────

def sanitize_review_text(text):
    s = text.strip()
    s = _RE_EMAIL.sub("[redacted]", s)
    s = _RE_HANDLE.sub("[redacted]", s)
    return re.sub(r"\n{3,}", "\n\n", s)


def load_reviews(hostel_id):
    """A hostel's reviews with text, newest first, with the guests' scores (0-100)."""
    return db.fetch_all(
        """
        SELECT text, reviewed_on, score_overall, score_security, score_location, score_staff,
               score_atmosphere, score_cleanliness, score_facilities, score_value
        FROM reviews
        WHERE hostel_id = %s AND length(text) >= 3
        ORDER BY reviewed_on DESC, id DESC
        """,
        (hostel_id,),
    )


def select_reviews(reviews, char_limit=REVIEW_CHAR_LIMIT):
    """The newest reviews (given newest first), whole reviews only, until the character budget is reached."""
    selected, total = [], 0
    for review in reviews:
        if total + len(review["text"]) > char_limit:
            break
        selected.append(review)
        total += len(review["text"])
    return selected


def review_block(reviews):
    return "\n---\n".join(sanitize_review_text(r["text"]) for r in reviews)


def make_state(block):
    return (
        "Hostel reviews written by guests on Hostelworld, separated by '---'.\n\n"
        f"---BEGIN REVIEWS---\n{block}\n---END REVIEWS---"
    )


def rate_question(aspect):
    instructions = f"Analyze the hostel reviews and provide a numerical rating for the aspect **{aspect}**."
    if aspect in ASPECT_NOTES:
        instructions += f" Note: {ASPECT_NOTES[aspect]}"
    return {"type": "score", "instructions": instructions, "criteria": LEVELS}


def truncate_block(block, fraction):
    """Drop whole reviews from the end until the block is at most `fraction` of its length."""
    parts = block.split("\n---\n")
    target = int(len(block) * fraction)
    while len(parts) > 1 and len("\n---\n".join(parts)) > target:
        parts.pop()
    return "\n---\n".join(parts)


# ── Jev call ────────────────────────────────────────────────────────────────

def ask_jev(block, aspects=(), max_attempts=6, timeout=120, questions=None):
    """
    One batched Jev call: a Score question per aspect, or the `questions` given. Shrinks
    the review block on context-length errors and backs off on rate limits / server
    errors. Returns the answers map.
    """
    questions = questions or {a: rate_question(a) for a in aspects}
    fraction, last_error = 1.0, ""
    for attempt in range(1, max_attempts + 1):
        state = make_state(block if fraction >= 1.0 else truncate_block(block, fraction))
        try:
            response = requests.post(
                f"{OPENROUTER_BASE_URL}/systemone",
                headers={"Authorization": f"Bearer {config.OPENROUTER_API_KEY}"},
                json={"model": RATING_MODEL, "state": state, "questions": questions},
                timeout=timeout,
            )
        except requests.RequestException as e:
            last_error = f"network: {e}"
            time.sleep(min(60, 2 ** attempt))
            continue

        if response.status_code == 200:
            return response.json()["answers"]

        text = response.text[:500]
        last_error = f"HTTP {response.status_code}: {text}"
        if response.status_code in (400, 413) and re.search(r"token|context|too long|length|size", text, re.I):
            fraction *= 0.9
            continue
        if response.status_code == 429 or response.status_code >= 500:
            time.sleep(float(response.headers.get("Retry-After") or 0) or min(60, 2 ** attempt))
            continue
        break
    raise RuntimeError(last_error)


def score_to_rating(answer):
    score = answer.get("score")
    if score is None:
        return None
    return max(0.0, min(1.0, float(score) / (len(LEVELS) - 1)))


# ── Calibration ─────────────────────────────────────────────────────────────

def load_calibration():
    with open(CALIBRATION_PATH, "r") as f:
        return json.load(f)


def calibrate(raw, calibration):
    out = {}
    for aspect, value in raw.items():
        fit = calibration["aspects"].get(aspect)
        if value is None or fit is None:
            out[aspect] = value
        else:
            out[aspect] = round(max(0.0, min(1.0, fit["slope"] * value + fit["intercept"])), 3)
    return out


# ── Public ──────────────────────────────────────────────────────────────────

def rate_hostel(reviews, aspects=ASPECTS):
    """
    Rate a hostel from its reviews (load_reviews). Returns None if there are no usable
    reviews, else {"model", "n_reviews", "raw", "calibrated"} with ratings on 0..1.
    """
    selected = select_reviews(reviews)
    if not selected:
        return None
    calibration = load_calibration()
    if calibration["model"] != RATING_MODEL:
        raise RuntimeError(f"Calibration is for {calibration['model']}, not {RATING_MODEL}; rerun calibrate_ratings.py")
    answers = ask_jev(review_block(selected), aspects)
    raw = {a: score_to_rating(answers.get(a, {})) for a in aspects}
    return {
        "model": RATING_MODEL,
        "n_reviews": len(selected),
        "raw": raw,
        "calibrated": calibrate(raw, calibration),
    }


def save_rating(hostel_id, rating):
    db.execute(
        """
        INSERT INTO jev_ratings (hostel_id, model, n_reviews, raw, calibrated) VALUES (%s, %s, %s, %s, %s)
        ON CONFLICT (hostel_id) DO UPDATE SET
            model = EXCLUDED.model, n_reviews = EXCLUDED.n_reviews, raw = EXCLUDED.raw,
            calibrated = EXCLUDED.calibrated, rated_at = now()
        """,
        (hostel_id, rating["model"], rating["n_reviews"], Jsonb(rating["raw"]), Jsonb(rating["calibrated"])),
    )
