-- One row per phone that turned on notifications. No food data is stored here:
-- only the push address, time zone, reminder times, and yes/no flags about today.
CREATE TABLE IF NOT EXISTS subs (
  id TEXT PRIMARY KEY,          -- sha-256 of the push endpoint
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  tz TEXT NOT NULL,
  prefs TEXT NOT NULL,          -- JSON reminder settings
  status TEXT NOT NULL DEFAULT '{}', -- JSON { date, meals: [], goalsMet, lastWeigh }
  sent TEXT NOT NULL DEFAULT '{}',   -- JSON { reminderKey: 'YYYY-MM-DD' } so each fires once a day
  updated INTEGER NOT NULL
);
