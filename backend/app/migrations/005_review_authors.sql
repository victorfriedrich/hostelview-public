-- Who wrote each review: Hostelworld's user id, so one guest's reviews of different hostels
-- can be linked ("guests who loved the hostel you disliked", app/recommend.py).
--
-- A table of its own rather than a column on reviews: filling a new column would rewrite
-- every review row, which the 500 MB production volume can't hold twice. Rows come from the
-- review crawler (not in the public repository).
CREATE TABLE review_authors (
    review_id    bigint PRIMARY KEY REFERENCES reviews (id) ON DELETE CASCADE,
    reviewer_id  bigint NOT NULL
);
CREATE INDEX review_authors_reviewer_idx ON review_authors (reviewer_id);
