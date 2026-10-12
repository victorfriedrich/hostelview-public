-- hostel_segments (004_hostel_segments.sql) as plain review counts: segment -> how many of the
-- hostel's reviews came from it. Each segment's average score and prior were only read by the
-- traveller profile's "rated well by people like you", which For you no longer has. What's
-- left reads only the counts: the crowd tags and the For you similarity.
--
--   traveller   solo_female, solo_male, couple, group
--   age         18-24, 25-30, 31-40, 41+
--   experience  new (0-2 Hostelworld reviews written), regular (3-10), seasoned (11+)

DROP MATERIALIZED VIEW hostel_segments;

CREATE MATERIALIZED VIEW hostel_segments AS
WITH counts AS (
    SELECT hostel_id,
           count(*) FILTER (WHERE group_type = 'FEMALE')                                         AS solo_female,
           count(*) FILTER (WHERE group_type = 'MALE')                                           AS solo_male,
           count(*) FILTER (WHERE group_type = 'COUPLE')                                         AS couple,
           count(*) FILTER (WHERE group_type IN ('MIXEDGROUP', 'ALLFEMALEGROUP', 'ALLMALEGROUP')) AS "group",
           count(*) FILTER (WHERE age_range = '18-24')                                           AS a18_24,
           count(*) FILTER (WHERE age_range = '25-30')                                           AS a25_30,
           count(*) FILTER (WHERE age_range = '31-40')                                           AS a31_40,
           count(*) FILTER (WHERE age_range = '41+')                                             AS a41,
           count(*) FILTER (WHERE reviewer_reviews <= 2)                                         AS new,
           count(*) FILTER (WHERE reviewer_reviews BETWEEN 3 AND 10)                             AS regular,
           count(*) FILTER (WHERE reviewer_reviews > 10)                                         AS seasoned
    FROM reviews
    WHERE score_overall IS NOT NULL
    GROUP BY hostel_id
)
SELECT hostel_id,
       jsonb_build_object(
           'traveller',  jsonb_strip_nulls(jsonb_build_object('solo_female', nullif(solo_female, 0),
                             'solo_male', nullif(solo_male, 0), 'couple', nullif(couple, 0), 'group', nullif("group", 0))),
           'age',        jsonb_strip_nulls(jsonb_build_object('18-24', nullif(a18_24, 0), '25-30', nullif(a25_30, 0),
                             '31-40', nullif(a31_40, 0), '41+', nullif(a41, 0))),
           'experience', jsonb_strip_nulls(jsonb_build_object('new', nullif(new, 0), 'regular', nullif(regular, 0),
                             'seasoned', nullif(seasoned, 0)))
       ) AS segments
FROM counts;

CREATE UNIQUE INDEX hostel_segments_hostel_id_idx ON hostel_segments (hostel_id);
