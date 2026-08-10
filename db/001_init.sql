-- Baby Names App — initial schema.
-- Lives in its own schema so it can share a Supabase project without colliding
-- with anything in public.

CREATE SCHEMA IF NOT EXISTS babynames;

-- Every name we've made a decision on. This IS the exclusion list.
CREATE TABLE IF NOT EXISTS babynames.decisions (
  name_key    TEXT PRIMARY KEY,             -- normalised; see lib/nameKey.ts
  display     TEXT NOT NULL,                -- original casing, e.g. "Saoirse"
  gender      TEXT,                         -- 'girl' | 'boy' | 'neutral'
  origin      TEXT,
  tags        JSONB       NOT NULL DEFAULT '[]'::jsonb,
  source      TEXT        NOT NULL DEFAULT 'library',  -- 'library' | 'ai'
  verdict     TEXT        NOT NULL CHECK (verdict IN ('like','pass')),
  rank        INTEGER,                      -- position in the liked list
  decided_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS decisions_verdict_idx ON babynames.decisions (verdict);
CREATE INDEX IF NOT EXISTS decisions_rank_idx    ON babynames.decisions (rank) WHERE verdict = 'like';
CREATE INDEX IF NOT EXISTS decisions_recent_idx  ON babynames.decisions (decided_at DESC);

-- The rolling stack of undecided candidates. Rows are DELETEd on decision.
CREATE SEQUENCE IF NOT EXISTS babynames.queue_position_seq;

CREATE TABLE IF NOT EXISTS babynames.queue (
  name_key  TEXT PRIMARY KEY,
  display   TEXT   NOT NULL,
  gender    TEXT   NOT NULL,
  origin    TEXT,
  tags      JSONB  NOT NULL DEFAULT '[]'::jsonb,
  source    TEXT   NOT NULL,
  position  BIGINT NOT NULL DEFAULT nextval('babynames.queue_position_seq'),
  added_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS queue_pos_idx        ON babynames.queue (position);
CREATE INDEX IF NOT EXISTS queue_gender_pos_idx ON babynames.queue (gender, position);

-- Single-row app preferences.
CREATE TABLE IF NOT EXISTS babynames.preferences (
  id              INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  origins         JSONB   NOT NULL DEFAULT '[]'::jsonb,
  similar_new_mix NUMERIC NOT NULL DEFAULT 0.6 CHECK (similar_new_mix BETWEEN 0 AND 1),
  origin_mode     TEXT    NOT NULL DEFAULT 'soft' CHECK (origin_mode IN ('soft','hard')),
  surname         TEXT,
  topup_threshold INTEGER NOT NULL DEFAULT 30 CHECK (topup_threshold > 0)
);

INSERT INTO babynames.preferences (id, surname)
VALUES (1, 'Strindberg')
ON CONFLICT (id) DO NOTHING;

-- Defence in depth. The app connects as the table owner (which bypasses RLS),
-- but if this schema is ever added to Supabase's exposed schemas, PostgREST
-- callers get nothing rather than the whole shortlist.
ALTER TABLE babynames.decisions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE babynames.queue       ENABLE ROW LEVEL SECURITY;
ALTER TABLE babynames.preferences ENABLE ROW LEVEL SECURITY;
