-- D1 schema: multi-tenant via uid

PRAGMA foreign_keys=OFF;

CREATE TABLE IF NOT EXISTS tenants (
  uid TEXT PRIMARY KEY,
  name TEXT,
  discord_server_id TEXT UNIQUE,
  github_owner TEXT,
  github_repo TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS discord_messages (
  uid TEXT NOT NULL,
  message_id TEXT NOT NULL,
  channel_id TEXT,
  author_id TEXT,
  author_display_name TEXT,
  author_avatar_url TEXT,
  ts INTEGER,
  content TEXT,
  PRIMARY KEY (uid, message_id)
);
CREATE INDEX IF NOT EXISTS idx_dm_uid_ts ON discord_messages(uid, ts DESC);

-- Full-text search on content (if supported)
CREATE VIRTUAL TABLE IF NOT EXISTS discord_messages_fts USING fts5(
  content,
  uid UNINDEXED,
  message_id UNINDEXED,
  tokenize='unicode61'
);

CREATE TABLE IF NOT EXISTS discord_topics (
  uid TEXT NOT NULL,
  topic TEXT NOT NULL,
  message_id TEXT NOT NULL,
  score REAL,
  PRIMARY KEY (uid, topic, message_id)
);
CREATE INDEX IF NOT EXISTS idx_dt_uid_topic ON discord_topics(uid, topic);

CREATE TABLE IF NOT EXISTS unanswered_questions (
  uid TEXT NOT NULL,
  qid TEXT NOT NULL,
  text TEXT NOT NULL,
  detected_at INTEGER,
  resolved INTEGER DEFAULT 0,
  resolved_at INTEGER,
  PRIMARY KEY (uid, qid)
);

CREATE TABLE IF NOT EXISTS gh_stargazers (
  uid TEXT NOT NULL,
  login TEXT NOT NULL,
  starred_at TEXT,
  avatar_url TEXT,
  company TEXT,
  company_org TEXT,
  company_public_members INTEGER,
  html_url TEXT,
  PRIMARY KEY (uid, login)
);

CREATE TABLE IF NOT EXISTS gh_interesting (
  uid TEXT NOT NULL,
  login TEXT NOT NULL,
  score INTEGER,
  reason TEXT,
  last_scored_at INTEGER,
  PRIMARY KEY (uid, login)
);
CREATE INDEX IF NOT EXISTS idx_ghint_uid_score ON gh_interesting(uid, score DESC);

CREATE TABLE IF NOT EXISTS insights (
  uid TEXT NOT NULL,
  kind TEXT NOT NULL,
  data TEXT NOT NULL,
  generated_at INTEGER,
  ttl_seconds INTEGER,
  PRIMARY KEY (uid, kind)
);


