-- Custom SQL migration file, put your code below! --
-- The study starts in QA mode; the dashboard's launch action flips this single row to live.
INSERT INTO "study_admin_state" ("id", "is_live") VALUES (1, 0) ON CONFLICT ("id") DO NOTHING;
