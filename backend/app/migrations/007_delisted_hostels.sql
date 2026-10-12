-- Hostels that dropped off Hostelworld. The crawler sets delisted_at when a hostel
-- has been missing from its city's property list for three weeks, and clears it when the
-- hostel is listed again. Delisted hostels keep their page but leave city lists, city figures
-- and recommendations.
ALTER TABLE hostels ADD COLUMN delisted_at timestamptz;

-- price_quotes.scraped_on was the Monday the stays were priced from, up to six days ahead of
-- the crawl; it is now the crawl date. Pull the few future dates back so the latest quotes
-- still sort last.
UPDATE price_quotes SET scraped_on = current_date WHERE scraped_on > current_date;

-- Apply the crawler's rule to past crawls: not listed in the three weeks before the city's
-- last crawl (every listed hostel gets price quotes).
UPDATE hostels h SET delisted_at = now()
FROM cities c
WHERE c.id = h.city_id AND c.crawled_at IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM price_quotes q
                  WHERE q.hostel_id = h.id AND q.scraped_on > c.crawled_at::date - 21);

-- city_stats (002_derived_views.sql) without delisted hostels.
DROP MATERIALIZED VIEW city_stats;

-- Map figures per city, from its five most-reviewed hostels (at least 50 scraped reviews each),
-- weighted by review count: average rating and atmosphere, average dorm price, and the
-- best-rated of the five with its dorm price.
CREATE MATERIALIZED VIEW city_stats AS
WITH ranked AS (
    SELECT h.city_id, s.hostel_id, s.review_count, s.overall, s.atmosphere, s.dorm_from,
           row_number() OVER (PARTITION BY h.city_id ORDER BY s.review_count DESC, s.hostel_id) AS rank
    FROM hostels h
    JOIN hostel_stats s ON s.hostel_id = h.id
    WHERE s.review_count >= 50 AND h.delisted_at IS NULL
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
    WHERE h.delisted_at IS NULL
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
