CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT NOT NULL, at INTEGER NOT NULL);

CREATE TABLE users (id TEXT PRIMARY KEY, login TEXT NOT NULL, email TEXT, google TEXT, created TEXT, data TEXT NOT NULL, github TEXT);

CREATE UNIQUE INDEX users_login ON users (lower(login));

CREATE INDEX users_email ON users (email);

CREATE INDEX users_google ON users (google);

CREATE TABLE sessions (h TEXT PRIMARY KEY, uid TEXT NOT NULL, exp INTEGER NOT NULL);

CREATE INDEX sessions_uid ON sessions (uid);

CREATE TABLE payments (id TEXT PRIMARY KEY, tx TEXT, uid TEXT, status TEXT, at INTEGER, data TEXT NOT NULL);

CREATE INDEX payments_tx ON payments (tx);

CREATE INDEX payments_status ON payments (status);

CREATE INDEX payments_at ON payments (at);

CREATE TABLE chats (uid TEXT NOT NULL, cid TEXT NOT NULL, v INTEGER NOT NULL, at INTEGER NOT NULL, data TEXT, PRIMARY KEY (uid, cid));

CREATE INDEX chats_v ON chats (uid, v);

CREATE TABLE chatmeta (uid TEXT PRIMARY KEY, rev INTEGER NOT NULL, mv INTEGER NOT NULL, meta TEXT);

CREATE INDEX users_github ON users (github);

CREATE TABLE referrals (id TEXT PRIMARY KEY, ref TEXT NOT NULL, ip TEXT, fp TEXT, status TEXT NOT NULL DEFAULT 'pending', msg INTEGER NOT NULL DEFAULT 0, paid INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL);

CREATE INDEX idx_referrals_ref ON referrals(ref);

CREATE INDEX idx_referrals_ip ON referrals(ip, at);

CREATE INDEX idx_referrals_fp ON referrals(fp, at);

CREATE TABLE modelstats (id INTEGER PRIMARY KEY AUTOINCREMENT, model TEXT NOT NULL, kind TEXT NOT NULL, ok INTEGER NOT NULL, ms INTEGER, first INTEGER, err TEXT, at INTEGER NOT NULL);

CREATE INDEX idx_modelstats_model_at ON modelstats(model, at);
CREATE TABLE reviews (id TEXT PRIMARY KEY, uid TEXT NOT NULL, nick TEXT NOT NULL, rating INTEGER NOT NULL, text TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', at INTEGER NOT NULL);

CREATE UNIQUE INDEX idx_reviews_uid ON reviews(uid);

CREATE INDEX idx_reviews_status_at ON reviews(status, at DESC);
