-- The pumpkin's keys (worker.mjs). Applied with:
--   npx wrangler d1 execute d2mm-pumpkin --remote --file schema.sql

-- a chase's ticket, once it has bought a key
CREATE TABLE IF NOT EXISTS tickets (
  nonce TEXT PRIMARY KEY,
  used_at INTEGER NOT NULL
);

-- every key handed out, and the install that spent it
CREATE TABLE IF NOT EXISTS keys (
  key TEXT PRIMARY KEY,          -- 16 characters, no dashes
  issued_at INTEGER NOT NULL,
  addr TEXT NOT NULL,            -- a keyed hash of the address that asked, for the daily limit
  install TEXT,                  -- the app install that spent it; NULL until then
  redeemed_at INTEGER
);
CREATE INDEX IF NOT EXISTS keys_addr ON keys (addr, issued_at);
