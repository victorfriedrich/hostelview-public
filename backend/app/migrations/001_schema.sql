-- Base tables. Ids are Hostelworld's own, so crawls upsert without lookups.

-- Tables from the first file-to-Postgres move (September 2026), superseded by this schema.
-- Kept in the `legacy` schema for their earlier Jev ratings, which were copied into
-- jev_ratings. On a new database this only creates the empty schema.
CREATE SCHEMA IF NOT EXISTS legacy;
ALTER TABLE IF EXISTS cities SET SCHEMA legacy;
ALTER TABLE IF EXISTS listings SET SCHEMA legacy;
ALTER TABLE IF EXISTS ratings SET SCHEMA legacy;
ALTER TABLE IF EXISTS listing_insights SET SCHEMA legacy;

CREATE TABLE cities (
    id          integer PRIMARY KEY,                -- Hostelworld city id
    slug        text NOT NULL UNIQUE,               -- URL segment: /listings/<slug>
    name        text NOT NULL,
    country     text NOT NULL DEFAULT '',
    lat         double precision,
    lon         double precision,
    crawled_at  timestamptz                         -- last property-list crawl
);

-- City ids Hostelworld doesn't know or lists no properties for; crawls skip them.
CREATE TABLE invalid_city_ids (
    id        integer PRIMARY KEY,
    found_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hostels (
    id                  integer PRIMARY KEY,        -- Hostelworld property id
    city_id             integer NOT NULL REFERENCES cities (id),
    name                text NOT NULL,
    -- Hostelworld's published scores (0-10) from the city property list.
    hw_rating           numeric(4, 2),
    hw_review_count     integer,
    hw_security         numeric(4, 2),
    hw_location         numeric(4, 2),
    hw_staff            numeric(4, 2),
    hw_atmosphere       numeric(4, 2),
    hw_cleanliness      numeric(4, 2),
    hw_facilities       numeric(4, 2),
    hw_value            numeric(4, 2),
    reviews_fetched_at  timestamptz,                -- last complete review fetch
    updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX hostels_city_id_idx ON hostels (city_id);

CREATE TABLE reviews (
    id                  bigint PRIMARY KEY,         -- Hostelworld review id
    hostel_id           integer NOT NULL REFERENCES hostels (id) ON DELETE CASCADE,
    reviewed_on         date NOT NULL,
    text                text NOT NULL DEFAULT '',   -- '' when the guest left no text
    -- The guest's scores, 0-100 as Hostelworld reports them.
    score_overall       smallint,
    score_security      smallint,
    score_location      smallint,
    score_staff         smallint,
    score_atmosphere    smallint,
    score_cleanliness   smallint,
    score_facilities    smallint,
    score_value         smallint,
    group_type          text,                       -- FEMALE, MALE, COUPLE, MIXEDGROUP, ALLFEMALEGROUP, ALLMALEGROUP
    age_range           text,                       -- 18-24, 25-30, 31-40, 41+
    nationality         text,                       -- ISO 3166 alpha-2, or ENG/SCO/WAL/NIR
    reviewer_reviews    integer,                    -- reviews this guest has written on Hostelworld
    language            text,
    machine_translated  boolean
);
CREATE INDEX reviews_hostel_date_idx ON reviews (hostel_id, reviewed_on DESC);

CREATE TABLE price_quotes (
    hostel_id    integer NOT NULL REFERENCES hostels (id) ON DELETE CASCADE,
    scraped_on   date NOT NULL,
    check_in     date NOT NULL,
    nights       smallint NOT NULL,
    dorm_eur     numeric(8, 2),                      -- cheapest dorm bed per night
    private_eur  numeric(8, 2),                      -- cheapest private room per night
    PRIMARY KEY (hostel_id, scraped_on, check_in)
);

-- Jev "Rate" ratings (app/ratings.py) over a hostel's newest reviews.
CREATE TABLE jev_ratings (
    hostel_id   integer PRIMARY KEY REFERENCES hostels (id) ON DELETE CASCADE,
    model       text NOT NULL,
    n_reviews   integer NOT NULL,
    raw         jsonb NOT NULL,                     -- aspect -> 0..1 as the model answered
    calibrated  jsonb NOT NULL,                     -- aspect -> 0..1 after calibration
    rated_at    timestamptz NOT NULL DEFAULT now()
);
