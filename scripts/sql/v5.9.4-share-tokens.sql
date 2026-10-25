-- v5.9.4 — SEC-5: share-ссылка была stateless JWT без возможности отозвать.
CREATE TABLE IF NOT EXISTS share_tokens (
  id uuid PRIMARY KEY,
  "entryId" uuid NOT NULL,
  "issuedBy" uuid NOT NULL,
  "revokedAt" timestamp without time zone,
  "createdAt" timestamp without time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_share_tokens_entry ON share_tokens ("entryId");
