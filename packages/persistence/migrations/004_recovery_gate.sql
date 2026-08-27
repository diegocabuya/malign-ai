-- N-1 to current upgrade marker. Existing history is preserved.
ALTER TABLE malign.games
  ADD COLUMN recovery_blocked boolean NOT NULL DEFAULT false;

CREATE INDEX games_recovery_blocked_idx
  ON malign.games (recovery_blocked, id)
  WHERE recovery_blocked;
