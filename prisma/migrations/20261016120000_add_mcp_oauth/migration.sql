-- MCP access for Claude connectors: OAuth 2.1 clients (dynamic client
-- registration), single-use authorization codes and access/refresh tokens.
-- Only SHA-256 hashes of secrets, codes and tokens are stored.
CREATE TABLE "mcp_oauth_clients" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "clientId" TEXT NOT NULL,
    "clientSecretHash" TEXT,
    "clientName" TEXT,
    "redirectUris" TEXT NOT NULL,
    "tokenEndpointAuthMethod" TEXT NOT NULL DEFAULT 'none',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" DATETIME
);
CREATE UNIQUE INDEX "mcp_oauth_clients_clientId_key" ON "mcp_oauth_clients"("clientId");

CREATE TABLE "mcp_oauth_codes" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "codeHash" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "codeChallenge" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "resource" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mcp_oauth_codes_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "mcp_oauth_clients" ("clientId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "mcp_oauth_codes_codeHash_key" ON "mcp_oauth_codes"("codeHash");
CREATE INDEX "mcp_oauth_codes_clientId_idx" ON "mcp_oauth_codes"("clientId");

CREATE TABLE "mcp_oauth_tokens" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tokenHash" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "scope" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    "lastUsedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mcp_oauth_tokens_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "mcp_oauth_clients" ("clientId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "mcp_oauth_tokens_tokenHash_key" ON "mcp_oauth_tokens"("tokenHash");
CREATE INDEX "mcp_oauth_tokens_clientId_idx" ON "mcp_oauth_tokens"("clientId");
CREATE INDEX "mcp_oauth_tokens_expiresAt_idx" ON "mcp_oauth_tokens"("expiresAt");
