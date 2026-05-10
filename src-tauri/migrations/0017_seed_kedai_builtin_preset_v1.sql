-- Deprecated migration placeholder.
--
-- The original 0017 migration attempted to seed a built-in "可待" preset into runtime data.
-- That conflicts with the repository rule that rewritten presets must stay as standalone artifacts,
-- not be baked into the application runtime. The previous file was also truncated and caused
-- SQLite to fail with an "incomplete input" migration error during app startup.
--
-- Keep version 0017 as an explicit no-op so migration ordering remains stable for databases
-- that have not successfully applied this version yet.
SELECT 1;
