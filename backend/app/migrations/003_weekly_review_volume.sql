-- Reviews per calendar week (Monday start), from a hostel's first review to its last
-- (empty weeks included). Replaces the 14-day blocks, which were too coarse to read and
-- didn't line up with anything a guest would recognise.
-- Databases set up from an early draft of 002 have it as a materialized view.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_matviews WHERE matviewname = 'hostel_review_volume') THEN
        DROP MATERIALIZED VIEW hostel_review_volume;
    ELSE
        DROP VIEW IF EXISTS hostel_review_volume;
    END IF;
END $$;

CREATE VIEW hostel_review_volume AS
WITH bounds AS (
    SELECT hostel_id, min(reviewed_on) AS first_on, max(reviewed_on) AS last_on
    FROM reviews GROUP BY hostel_id
),
blocks AS (
    SELECT b.hostel_id, gs::date AS block_start
    FROM bounds b, generate_series(date_trunc('week', b.first_on), b.last_on, interval '7 days') gs
)
SELECT bl.hostel_id, bl.block_start, count(r.id)::integer AS reviews
FROM blocks bl
LEFT JOIN reviews r
       ON r.hostel_id = bl.hostel_id
      AND r.reviewed_on >= bl.block_start
      AND r.reviewed_on < bl.block_start + 7
GROUP BY bl.hostel_id, bl.block_start;
