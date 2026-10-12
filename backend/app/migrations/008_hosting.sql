-- What a hostel offers and organises, for the For you tab's similarity (app/similarity.py).
--
-- facilities: Hostelworld's facility flags from the city property list, as "CATEGORY:ID"
-- (e.g. FREE:BREAKFASTINCLUDED, AVAILABLEFORAFEE:BREAKFASTNOTINCLUDED = breakfast for a fee,
-- FOODANDDRINKS:BAR). Self-reported by the hostels; set by the crawler.
ALTER TABLE hostels ADD COLUMN facilities text[];

-- What the reviews say a hostel hosts, judged by Jev over its newest reviews (app/hosting.py):
-- shared meals and organised (non-drinking) activities scored 0..1 like the aspect ratings,
-- and breakfast 0..1 by how often reviews mention it; with Jev's answers.
CREATE TABLE hostel_hosting (
    hostel_id             integer PRIMARY KEY REFERENCES hostels (id) ON DELETE CASCADE,
    model                 text NOT NULL,
    n_reviews             integer NOT NULL,
    hosted_meals          real,
    organised_activities  real,
    breakfast             real,
    answers               jsonb NOT NULL,
    judged_at             timestamptz NOT NULL DEFAULT now()
);
