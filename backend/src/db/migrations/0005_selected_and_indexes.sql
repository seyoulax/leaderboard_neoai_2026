ALTER TABLE submissions ADD COLUMN selected INTEGER NOT NULL DEFAULT 0
  CHECK (selected IN (0, 1));

CREATE INDEX submissions_selected
  ON submissions (task_id, user_id, id)
  WHERE selected = 1 AND status = 'scored';

CREATE INDEX submissions_selected_score_private
  ON submissions (task_id, user_id, points_private DESC, id)
  WHERE selected = 1 AND status = 'scored' AND points_private IS NOT NULL;
