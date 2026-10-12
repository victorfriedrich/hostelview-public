-- Guest scores per kind of traveller, for "rated well by people like you".
--
-- A segment is one value of one dimension:
--   traveller   solo_female, solo_male, couple, group
--   age         18-24, 25-30, 31-40, 41+
--   experience  new (0-2 Hostelworld reviews written), regular (3-10), seasoned (11+)
--
-- Per hostel and segment: how many of its reviews came from that segment, their average
-- overall score, and the prior that average is shrunk towards when it rests on few reviews
-- (the frontend does the shrinking). The prior is the hostel's own average plus how far
-- that segment rates above or below the hostels it stays at, over all reviews: some
-- segments score everything higher, and without the shift hostels popular with them would
-- look better for them than they are.
--
-- Reviews are read once and grouped by hostel only, so nothing larger than one row per
-- hostel is ever held: the production volume is small, and an earlier draft that
-- materialised a row per review and segment ran it out of disk.

CREATE MATERIALIZED VIEW hostel_segments AS
WITH per_hostel AS (
    SELECT hostel_id,
           count(*) AS n,
           sum(score_overall) / 10.0 AS total,
           count(*)           FILTER (WHERE group_type = 'FEMALE')                                         AS n_solo_female,
           sum(score_overall) FILTER (WHERE group_type = 'FEMALE') / 10.0                                  AS t_solo_female,
           count(*)           FILTER (WHERE group_type = 'MALE')                                           AS n_solo_male,
           sum(score_overall) FILTER (WHERE group_type = 'MALE') / 10.0                                    AS t_solo_male,
           count(*)           FILTER (WHERE group_type = 'COUPLE')                                         AS n_couple,
           sum(score_overall) FILTER (WHERE group_type = 'COUPLE') / 10.0                                  AS t_couple,
           count(*)           FILTER (WHERE group_type IN ('MIXEDGROUP', 'ALLFEMALEGROUP', 'ALLMALEGROUP')) AS n_group,
           sum(score_overall) FILTER (WHERE group_type IN ('MIXEDGROUP', 'ALLFEMALEGROUP', 'ALLMALEGROUP')) / 10.0 AS t_group,
           count(*)           FILTER (WHERE age_range = '18-24')                                           AS n_18_24,
           sum(score_overall) FILTER (WHERE age_range = '18-24') / 10.0                                    AS t_18_24,
           count(*)           FILTER (WHERE age_range = '25-30')                                           AS n_25_30,
           sum(score_overall) FILTER (WHERE age_range = '25-30') / 10.0                                    AS t_25_30,
           count(*)           FILTER (WHERE age_range = '31-40')                                           AS n_31_40,
           sum(score_overall) FILTER (WHERE age_range = '31-40') / 10.0                                    AS t_31_40,
           count(*)           FILTER (WHERE age_range = '41+')                                             AS n_41,
           sum(score_overall) FILTER (WHERE age_range = '41+') / 10.0                                      AS t_41,
           count(*)           FILTER (WHERE reviewer_reviews <= 2)                                         AS n_new,
           sum(score_overall) FILTER (WHERE reviewer_reviews <= 2) / 10.0                                  AS t_new,
           count(*)           FILTER (WHERE reviewer_reviews BETWEEN 3 AND 10)                             AS n_regular,
           sum(score_overall) FILTER (WHERE reviewer_reviews BETWEEN 3 AND 10) / 10.0                      AS t_regular,
           count(*)           FILTER (WHERE reviewer_reviews > 10)                                         AS n_seasoned,
           sum(score_overall) FILTER (WHERE reviewer_reviews > 10) / 10.0                                  AS t_seasoned
    FROM reviews
    WHERE score_overall IS NOT NULL
    GROUP BY hostel_id
),
segments AS (
    SELECT p.hostel_id, s.dim, s.val, s.n, s.total, p.total / p.n AS mean
    FROM per_hostel p
    CROSS JOIN LATERAL (VALUES
        ('traveller',  'solo_female', p.n_solo_female, p.t_solo_female),
        ('traveller',  'solo_male',   p.n_solo_male,   p.t_solo_male),
        ('traveller',  'couple',      p.n_couple,      p.t_couple),
        ('traveller',  'group',       p.n_group,       p.t_group),
        ('age',        '18-24',       p.n_18_24,       p.t_18_24),
        ('age',        '25-30',       p.n_25_30,       p.t_25_30),
        ('age',        '31-40',       p.n_31_40,       p.t_31_40),
        ('age',        '41+',         p.n_41,          p.t_41),
        ('experience', 'new',         p.n_new,         p.t_new),
        ('experience', 'regular',     p.n_regular,     p.t_regular),
        ('experience', 'seasoned',    p.n_seasoned,    p.t_seasoned)
    ) AS s (dim, val, n, total)
    WHERE s.n > 0
),
shifts AS (
    -- The mean of (score - hostel average) over a segment's reviews: (Σ total - Σ n·mean) / Σ n.
    SELECT dim, val, (sum(total) - sum(n * mean)) / sum(n) AS shift
    FROM segments
    GROUP BY dim, val
)
SELECT d.hostel_id, jsonb_object_agg(d.dim, d.segments) AS segments
FROM (
    SELECT s.hostel_id, s.dim,
           jsonb_object_agg(s.val, jsonb_build_object(
               'n', s.n,
               'rating', round(s.total / s.n, 2),
               'prior', round(s.mean + h.shift, 2)
           )) AS segments
    FROM segments s
    JOIN shifts h USING (dim, val)
    GROUP BY s.hostel_id, s.dim
) d
GROUP BY d.hostel_id;

CREATE UNIQUE INDEX hostel_segments_hostel_id_idx ON hostel_segments (hostel_id);
