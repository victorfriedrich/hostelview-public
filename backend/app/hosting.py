"""
What a hostel offers and hosts, for the For you tab's similarity (app/similarity.py).

From Hostelworld's facility flags (hostels.facilities), grouped into a few (FLAGS): breakfast,
bar, food served, guest kitchen, free city tour, pool. The flags are self-reported.

From the reviews, judged by Jev in one call per hostel over its newest reviews (the same
selection as the aspect ratings, app/ratings.py):

- hosted_meals, organised_activities: Score questions like the aspect ratings (0..1),
  uncalibrated like party and social
- breakfast: a Choice question on how often reviews mention breakfast at the hostel, its
  probabilities weighed 1 for "many", 0.5 for "a few", 0 for "none". The hostel counts as
  having breakfast from BREAKFAST_FROM, or when its flags say so.
"""
from psycopg.types.json import Jsonb

from app import db
from app.ratings import RATING_MODEL, ask_jev, load_reviews, rate_question, review_block, score_to_rating, select_reviews

# Grouped facility flags: any of the Hostelworld ids ("CATEGORY:ID") sets one.
FLAGS = {
    "breakfast": ("FREE:BREAKFASTINCLUDED", "AVAILABLEFORAFEE:BREAKFASTNOTINCLUDED"),
    "bar": ("FOODANDDRINKS:BAR", "ENTERTAINMENT:ROOFTOPBAR", "ENTERTAINMENT:NIGHTCLUB"),
    "food": ("FOODANDDRINKS:MEALSAVAILABLE", "FOODANDDRINKS:RESTAURANT", "FOODANDDRINKS:CAF", "FOODANDDRINKS:CAFE"),
    "kitchen": ("KITCHEN:KITCHEN", "KITCHEN:COOKER", "KITCHEN:STOVE"),
    "free_tour": ("FREE:FREECITYTOUR",),
    "pool": ("WELLNESS:SWIMMINGPOOL", "WELLNESS:OUTDOORSWIMMINGPOOL", "WELLNESS:INDOORSWIMMINGPOOL"),
}


# Not used yet: groundwork for a "breakfast included" filter. Breakfast and bar were taken out of
# the For you similarity (similarity.py), where the patchy flags pulled matches off the party circuit.
def flags(facilities):
    """{flag: True/False} from a hostel's facility ids, or None when they haven't been fetched."""
    if facilities is None:
        return None
    have = set(facilities)
    return {flag: any(i in have for i in ids) for flag, ids in FLAGS.items()}


def has_breakfast(facilities, jev_breakfast):
    """Breakfast at the hostel by its flags or its reviews (Jev from BREAKFAST_FROM); None when neither is known."""
    if facilities is None and jev_breakfast is None:
        return None
    return bool((flags(facilities) or {}).get("breakfast")) or (jev_breakfast or 0) >= BREAKFAST_FROM


ASPECT_NOTES = {
    "hosted_meals": "Shared meals the hostel itself hosts for guests: family dinners, communal dinners, BBQ nights "
                    "the staff put on. Food it sells, a guest kitchen or dinners out do not count.",
    "organised_activities": "Non-drinking activities the hostel itself organises for guests: walking tours, hikes, "
                            "day trips, yoga, cooking classes, game or quiz nights. Pub crawls, nights out and tours "
                            "booked with other companies do not count.",
}
BREAKFAST = {
    "type": "choice",
    "instructions": "What do the reviews say about breakfast at the hostel?",
    "criteria": {
        "many": "Many reviews mention breakfast at the hostel (included or for a fee)",
        "few": "A few reviews mention breakfast at the hostel",
        "none": "The reviews don't mention breakfast at the hostel, or say there is none",
    },
}
WEIGHTS = {"many": 1.0, "few": 0.5, "none": 0.0}
BREAKFAST_FROM = 0.75


def score(answer):
    """The answer's probabilities weighed by WEIGHTS, 0..1, or None without an answer."""
    probs = (answer or {}).get("probabilities")
    if not probs:
        return None
    return round(sum(WEIGHTS.get(k, 0.0) * p for k, p in probs.items()), 3)


def judge_hostel(hostel_id):
    """A hostel_hosting row from Jev's judgement of its newest reviews, or None without review text."""
    selected = select_reviews(load_reviews(hostel_id))
    if not selected:
        return None
    questions = {a: {**rate_question(a), "instructions": f"{rate_question(a)['instructions']} Note: {note}"}
                 for a, note in ASPECT_NOTES.items()}
    answers = ask_jev(review_block(selected), questions={**questions, "breakfast": BREAKFAST})
    return {
        "hostel_id": hostel_id,
        "model": RATING_MODEL,
        "n_reviews": len(selected),
        **{a: round(score_to_rating(answers.get(a) or {}), 3) for a in ASPECT_NOTES},
        "breakfast": score(answers.get("breakfast")),
        "answers": answers,
    }


def save(row):
    db.upsert_rows("hostel_hosting", [{**row, "answers": Jsonb(row["answers"])}], key=["hostel_id"])
