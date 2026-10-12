-- hostel_review_history as a plain view everywhere. Databases set up from an early draft of
-- 002 have it as a materialized view, which nothing refreshes: hostels whose reviews arrived
-- later showed an empty review history. Same definition as 002.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_matviews WHERE matviewname = 'hostel_review_history') THEN
        DROP MATERIALIZED VIEW hostel_review_history;
    ELSE
        DROP VIEW IF EXISTS hostel_review_history;
    END IF;
END $$;

CREATE VIEW hostel_review_history AS
WITH daily AS (
    SELECT hostel_id, reviewed_on,
           count(*) AS n,
           sum(score_overall) AS overall, sum(score_security) AS security, sum(score_location) AS location,
           sum(score_staff) AS staff, sum(score_atmosphere) AS atmosphere, sum(score_cleanliness) AS cleanliness,
           sum(score_facilities) AS facilities, sum(score_value) AS value
    FROM reviews
    GROUP BY hostel_id, reviewed_on
),
rolling AS (
    SELECT hostel_id, reviewed_on,
           sum(n)           OVER w AS n,
           sum(overall)     OVER w AS overall,
           sum(security)    OVER w AS security,
           sum(location)    OVER w AS location,
           sum(staff)       OVER w AS staff,
           sum(atmosphere)  OVER w AS atmosphere,
           sum(cleanliness) OVER w AS cleanliness,
           sum(facilities)  OVER w AS facilities,
           sum(value)       OVER w AS value
    FROM daily
    WINDOW w AS (PARTITION BY hostel_id ORDER BY reviewed_on ROWS BETWEEN 13 PRECEDING AND CURRENT ROW)
)
SELECT hostel_id, reviewed_on, n::integer AS reviews,
       round(overall / n / 10.0, 2)     AS overall,
       round(security / n / 10.0, 2)    AS security,
       round(location / n / 10.0, 2)    AS location,
       round(staff / n / 10.0, 2)       AS staff,
       round(atmosphere / n / 10.0, 2)  AS atmosphere,
       round(cleanliness / n / 10.0, 2) AS cleanliness,
       round(facilities / n / 10.0, 2)  AS facilities,
       round(value / n / 10.0, 2)       AS value
FROM rolling;
