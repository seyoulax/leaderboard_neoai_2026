-- ───────────────────────────────────────────────────────────
-- Per-competition theme: accent color + preset (visual variant for leaderboard pages).
-- Stored as JSON blob: { "accent": "#7d5fff", "preset": "default" | "highlight-rising" | "minimal" }
-- Both fields optional. NULL theme = use defaults.
ALTER TABLE competitions ADD COLUMN theme_json TEXT;
