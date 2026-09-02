-- Name traits — what a name is like, derived from its spelling.
--
-- Keyed on name_key rather than hung off `decisions`, because a trait belongs
-- to the *name*, not to a decision about it: the same name can sit in `queue`,
-- in `decisions`, in the bundled library, or in none of them, and it should be
-- analysed once either way. That also lets the whole candidate pool be scored
-- or filtered in SQL rather than only in the app.
--
-- This table is a CACHE. Every column is a pure function of `display` (plus
-- `origin` as a pronunciation hint), so it can be dropped and rebuilt with
-- `npm run traits:push` at any time. `analysed_with` records the analyser
-- version that wrote the row, which is what makes a re-analysis a plain UPDATE
-- instead of a migration.

CREATE TABLE IF NOT EXISTS babynames.name_traits (
  name_key      TEXT PRIMARY KEY,
  display       TEXT     NOT NULL,          -- kept so the table reads on its own

  letters       SMALLINT NOT NULL,
  syllables     SMALLINT NOT NULL,
  onset         TEXT     NOT NULL,          -- vowel|stop|nasal|liquid|sibilant|fricative|glide
  ending        TEXT     NOT NULL,          -- vowel-a…vowel-u|nasal|liquid|sibilant|stop|fricative
  hardness      REAL     NOT NULL,          -- 0–1 plosive density
  softness      REAL     NOT NULL,          -- 0–1 sonorant density
  brightness    REAL     NOT NULL,          -- 0–1 front-vowel share
  vowel_ratio   REAL     NOT NULL,
  has_double    BOOLEAN  NOT NULL,
  has_cluster   BOOLEAN  NOT NULL,
  initial       TEXT     NOT NULL,

  analysed_with SMALLINT NOT NULL,
  analysed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The one index worth having up front: finding rows a newer analyser has left
-- behind. Everything else joins on the primary key, and at a few thousand rows
-- a sequential scan is cheaper than an index to maintain.
CREATE INDEX IF NOT EXISTS name_traits_stale_idx
  ON babynames.name_traits (analysed_with);

ALTER TABLE babynames.name_traits ENABLE ROW LEVEL SECURITY;

-- …which, without a policy, means the app role reads *nothing*. Not an error —
-- an empty result. This table was created with RLS on and no policy, so every
-- aggregate over it came back with n = 0 and the shortlist's insight card, whose
-- honest response to too little evidence is to render nothing, rendered nothing
-- while looking exactly like a feature that had not shipped. The other three
-- tables carry the same pair; it belongs in the migration, not in the setup
-- someone did by hand once.
GRANT SELECT, INSERT, UPDATE, DELETE ON babynames.name_traits TO babynames_app;

DROP POLICY IF EXISTS app_all ON babynames.name_traits;
CREATE POLICY app_all ON babynames.name_traits
  FOR ALL TO babynames_app USING (true) WITH CHECK (true);
