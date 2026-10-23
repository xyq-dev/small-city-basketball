-- Existing publications remain LIVE; closure never implicitly publishes history.
-- The existing generic publication guard includes purpose in its immutable JSON comparison.
ALTER TABLE public_event_publications
  ADD COLUMN purpose text NOT NULL DEFAULT 'LIVE'
  CHECK (purpose IN ('LIVE', 'HISTORY'));
