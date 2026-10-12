-- Per-hostel and per-city figures the API serves as-is. hostel_stats and city_stats
-- are materialized, refreshed after every crawl, review fetch and rating run
-- (app.db.refresh_derived). The per-hostel histories are plain views: the API only
-- asks for one hostel at a time, which takes milliseconds, and storing them for
-- every hostel would take a quarter of the database.

-- Guest scores (0-10), demographics and the current dorm price of every hostel.
CREATE MATERIALIZED VIEW hostel_stats AS
WITH scores AS (
    SELECT hostel_id,
           count(*)                                  AS review_count,
           min(reviewed_on)                          AS first_review_on,
           max(reviewed_on)                          AS last_review_on,
           round(avg(score_overall) / 10.0, 2)       AS overall,
           round(avg(score_security) / 10.0, 2)      AS security,
           round(avg(score_location) / 10.0, 2)      AS location,
           round(avg(score_staff) / 10.0, 2)         AS staff,
           round(avg(score_atmosphere) / 10.0, 2)    AS atmosphere,
           round(avg(score_cleanliness) / 10.0, 2)   AS cleanliness,
           round(avg(score_facilities) / 10.0, 2)    AS facilities,
           round(avg(score_value) / 10.0, 2)         AS value,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY reviewer_reviews) AS reviewer_reviews_median
    FROM reviews
    GROUP BY hostel_id
),
counted AS (
    -- One row per hostel, dimension and value.
    SELECT hostel_id, 'gender' AS dim,
           CASE WHEN group_type IN ('FEMALE', 'MALE') THEN group_type ELSE 'GROUP' END AS val
    FROM reviews WHERE group_type IS NOT NULL
    UNION ALL
    SELECT hostel_id, 'age', age_range FROM reviews WHERE age_range IS NOT NULL
    UNION ALL
    SELECT hostel_id, 'nationality', nationality FROM reviews WHERE nationality IS NOT NULL
    UNION ALL
    SELECT hostel_id, 'experience',
           CASE WHEN reviewer_reviews <= 0 THEN '0'
                WHEN reviewer_reviews <= 2 THEN '1-2'
                WHEN reviewer_reviews <= 5 THEN '3-5'
                WHEN reviewer_reviews <= 10 THEN '6-10'
                WHEN reviewer_reviews <= 20 THEN '11-20'
                WHEN reviewer_reviews <= 50 THEN '21-50'
                ELSE '51+' END
    FROM reviews WHERE reviewer_reviews IS NOT NULL
),
distributions AS (
    SELECT hostel_id,
           jsonb_object_agg(val, n) FILTER (WHERE dim = 'gender')      AS gender,
           jsonb_object_agg(val, n) FILTER (WHERE dim = 'age')         AS age,
           jsonb_object_agg(val, n) FILTER (WHERE dim = 'nationality') AS nationalities,
           jsonb_object_agg(val, n) FILTER (WHERE dim = 'experience')  AS experience
    FROM (SELECT hostel_id, dim, val, count(*) AS n FROM counted GROUP BY 1, 2, 3) c
    GROUP BY hostel_id
),
latest_prices AS (
    SELECT q.hostel_id, q.scraped_on, min(q.dorm_eur) AS dorm_from, min(q.private_eur) AS private_from
    FROM price_quotes q
    JOIN (SELECT hostel_id, max(scraped_on) AS scraped_on FROM price_quotes GROUP BY hostel_id) l
      USING (hostel_id, scraped_on)
    GROUP BY q.hostel_id, q.scraped_on
)
SELECT h.id                                  AS hostel_id,
       coalesce(s.review_count, 0)           AS review_count,
       s.first_review_on, s.last_review_on,
       s.overall, s.security, s.location, s.staff, s.atmosphere, s.cleanliness, s.facilities, s.value,
       d.gender, d.age, d.nationalities, d.experience,
       s.reviewer_reviews_median,
       p.dorm_from, p.private_from, p.scraped_on AS prices_scraped_on
FROM hostels h
LEFT JOIN scores s        ON s.hostel_id = h.id
LEFT JOIN distributions d ON d.hostel_id = h.id
LEFT JOIN latest_prices p ON p.hostel_id = h.id;

CREATE UNIQUE INDEX hostel_stats_hostel_id_idx ON hostel_stats (hostel_id);


-- Guest scores (0-10) averaged over a rolling window of the 14 most recent review dates,
-- one row per hostel and review date.
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


-- Reviews per 14-day block, from a hostel's first review to its last (empty blocks included).
CREATE VIEW hostel_review_volume AS
WITH bounds AS (
    SELECT hostel_id, min(reviewed_on) AS first_on, max(reviewed_on) AS last_on
    FROM reviews GROUP BY hostel_id
),
blocks AS (
    SELECT b.hostel_id, gs::date AS block_start
    FROM bounds b, generate_series(b.first_on, b.last_on, interval '14 days') gs
)
SELECT bl.hostel_id, bl.block_start, count(r.id)::integer AS reviews
FROM blocks bl
LEFT JOIN reviews r
       ON r.hostel_id = bl.hostel_id
      AND r.reviewed_on >= bl.block_start
      AND r.reviewed_on < bl.block_start + 14
GROUP BY bl.hostel_id, bl.block_start;


-- Map figures per city, from its five most-reviewed hostels (at least 50 scraped reviews each),
-- weighted by review count: average rating and atmosphere, average dorm price, and the
-- best-rated of the five with its dorm price.
CREATE MATERIALIZED VIEW city_stats AS
WITH ranked AS (
    SELECT h.city_id, s.hostel_id, s.review_count, s.overall, s.atmosphere, s.dorm_from,
           row_number() OVER (PARTITION BY h.city_id ORDER BY s.review_count DESC, s.hostel_id) AS rank
    FROM hostels h
    JOIN hostel_stats s ON s.hostel_id = h.id
    WHERE s.review_count >= 50
),
top5 AS (SELECT * FROM ranked WHERE rank <= 5),
weighted AS (
    SELECT city_id,
           round(sum(overall * review_count) FILTER (WHERE overall IS NOT NULL)
                 / nullif(sum(review_count) FILTER (WHERE overall IS NOT NULL), 0), 2)       AS avg_rating,
           round(sum(atmosphere * review_count) FILTER (WHERE atmosphere IS NOT NULL)
                 / nullif(sum(review_count) FILTER (WHERE atmosphere IS NOT NULL), 0), 2)    AS avg_atmosphere,
           round(sum(dorm_from * review_count) FILTER (WHERE dorm_from IS NOT NULL)
                 / nullif(sum(review_count) FILTER (WHERE dorm_from IS NOT NULL), 0), 2)     AS avg_dorm_price
    FROM top5
    GROUP BY city_id
),
best AS (
    SELECT DISTINCT ON (city_id) city_id, overall AS top_rating, dorm_from AS top_dorm_price
    FROM top5
    ORDER BY city_id, overall DESC NULLS LAST, review_count DESC
),
counts AS (
    SELECT h.city_id, count(*) AS hostel_count, count(*) FILTER (WHERE s.review_count > 0) AS reviewed_hostel_count
    FROM hostels h JOIN hostel_stats s ON s.hostel_id = h.id
    GROUP BY h.city_id
)
SELECT c.id AS city_id,
       coalesce(n.hostel_count, 0)          AS hostel_count,
       coalesce(n.reviewed_hostel_count, 0) AS reviewed_hostel_count,
       w.avg_rating, w.avg_atmosphere, w.avg_dorm_price,
       b.top_rating, b.top_dorm_price
FROM cities c
LEFT JOIN counts n   ON n.city_id = c.id
LEFT JOIN weighted w ON w.city_id = c.id
LEFT JOIN best b     ON b.city_id = c.id;

CREATE UNIQUE INDEX city_stats_city_id_idx ON city_stats (city_id);
