-- Hearts — a 0–3 favourite marker on a shortlisted name.
--
-- Deliberately a plain column rather than its own table: a heart has no
-- history worth keeping, only a current count, and the shortlist is read as a
-- single SELECT * that should not grow a join.

ALTER TABLE babynames.decisions
  ADD COLUMN IF NOT EXISTS hearts SMALLINT NOT NULL DEFAULT 0;

-- Postgres has no ADD CONSTRAINT IF NOT EXISTS, and db-push re-runs every file
-- on every push, so the duplicate has to be swallowed explicitly.
DO $$
BEGIN
  ALTER TABLE babynames.decisions
    ADD CONSTRAINT decisions_hearts_range CHECK (hearts BETWEEN 0 AND 3);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS decisions_hearts_idx
  ON babynames.decisions (hearts DESC) WHERE verdict = 'like';
