# Aerolíneas MCP

Remote MCP server that exposes Aerolíneas Argentinas flight search to LLM clients (Claude Code, claude.ai). Vercel serverless functions, stateless OAuth, no DB.

Production: `https://YOUR_DOMAIN` (replace with your own deployment URL — Vercel auto-assigns one on first deploy).

## Quick start

```bash
npm install
npm run smoke          # local MCP smoke test (stdio)
npm run smoke:http     # local MCP smoke test over HTTP (no auth)

# Deploy
vercel deploy --prod --yes

# Inspect prod
vercel inspect YOUR_DOMAIN --logs
vercel env ls production
```

To exercise the OAuth flow locally, set `JWT_SECRET=anything-long` and `ACCESS_PASSWORD=anything` and point the smoke at `api/oauth/*` handlers directly (see prior conversation logs for the exact pattern).

## Architecture

```
api/                      Vercel serverless functions
  mcp.js                  MCP endpoint (validates Bearer JWT)
  favicon.js              self-hosted favicon (base64 inlined)
  oauth/
    discovery-as.js       /.well-known/oauth-authorization-server  (via rewrite)
    discovery-rs.js       /.well-known/oauth-protected-resource    (via rewrite)
    register.js           Dynamic Client Registration (RFC 7591)
    authorize.js          consent screen + auth-code issuance
    token.js              code → tokens, refresh_token rotation
src/
  server.js               McpServer setup, schemas, tools, resources
  api.js                  raw HTTP call to api.aerolineas.com.ar
  token.js                Aerolíneas auth token scraping + caching
  transform.js            raw API payload → lean structured output
  combinations.js         find_best_combinations orchestrator
  format.js               markdown renderers for content[].text
  reference.js            static catalogs + server instructions
  url.js                  booking deep-link builder
  oauth.js                JWT helpers, OAuth shared utils
  jwt.js                  HS256 sign/verify (no deps)
vercel.json               rewrites for /.well-known/* and /oauth/*
```

Tools exposed: `search_flights`, `get_fare_rules`, `find_best_combinations`, `token_status`.
Resources: `aerolineas://reference/{brands,fare-options,cabin-classes,airports}`.

## Gotchas (real ones we hit)

### Aerolíneas API semantics

- **`enabled: true` does NOT mean "included free"** in `fareRules`. The discriminator is `detail`:
  - `enabled: false` → option not in this brand
  - `enabled: true, detail: ""` or `"Carry on de 8kg"` → INCLUDED FREE
  - `enabled: true, detail: "Cargo extra"` / `"$ 40.000"` / `"Con 40% de retención"` → AVAILABLE BUT PAID
  - We compute `inclusion: "free" | "paid" | "unavailable"` in `extractFareRules`. Never filter on `enabled` alone.
- **Brand semantics**: EB Base only includes Personal_Item free; carry-on is paid. EP Plus is the cheapest with free carry-on. Business brands (BA/BI/BC) have all options as `unavailable` in fareRules — data is unreliable for Business; the brand reference resource has hand-curated truth.
- **Two response shapes** for `/v1/flights/offers`:
  - `flexDates: true` → `calendarOffers` (object keyed by leg index, 30 days, one cheapest brand per day)
  - `flexDates: false` → `brandedOffers` (object keyed by leg index, one element per flight, multiple brands)
- **`combinableOffers`**: in branded responses, each offer carries the list of offer IDs from the other leg it can pair with. Use this for round-trip combos rather than assuming same-brand pairing.
- **API requires real browser headers** (User-Agent, Origin, Referer, x-channel-id) — see `api.js`. Plain curl returns 403 from Azure Application Gateway.

### Vercel quirks

- **Deployment Protection must stay OFF** in production for `.well-known/*` discovery to be reachable by OAuth clients. Auth is enforced at the application layer (OAuth + JWT). Don't re-enable.
- **`api/.well-known/` does NOT work** as a folder (Vercel excludes dotfiles). All `/.well-known/*` URLs go through rewrites in `vercel.json` → `/api/oauth/discovery-*`.
- **OAuth public paths** (`/oauth/authorize`, `/oauth/token`, `/oauth/register`) are also rewrites to `/api/oauth/*`. Without these rewrites the discovery doc advertises endpoints that 404.
- **Favicon is self-hosted via `api/favicon.js`** with the ICO inlined as base64. Reason: `www.aerolineas.com.ar/favicon.ico` returns 403 to requests without browser headers, so we can't redirect or proxy. Don't replace with a redirect.
- **Pre-connection favicon in claude.ai** uses Google's favicon resolver, which falls back to the parent domain (or returns a default) until it indexes a freshly-deployed subdomain. Post-connection uses `serverInfo.icons[0].src` which is a `data:image/x-icon;base64,...` URI — guaranteed correct.

### Code traps

- **Backticks inside the `serverInstructions` template literal** in `reference.js` MUST be escaped (`\``). Otherwise Node parses them as nested template literals and the build dies with `SyntaxError: Unexpected identifier`. Vercel's prod logs are the only place this shows.
- **`McpServer` constructor** takes `(serverInfo, serverOptions)`. `instructions` goes in the second arg, `icons`/`websiteUrl`/`description` go in the first.
- **Tool `content[].text` vs `structuredContent`**: per MCP spec, text is the human-readable rendering (we use markdown for visible tools, JSON for technical ones). structuredContent is the typed object for clients and chained calls. Never duplicate JSON in both — wastes tokens. See `format.js` + `asStructured()` in `server.js`.

### OAuth design

- **Stateless JWT**, no database. Authorization codes are 60s JWTs encoding PKCE challenge + redirect URI. Access tokens are 24h with `typ: "access"`. Refresh tokens are 90d with `typ: "refresh"` and rotate on every use (sliding expiry).
- **MCP endpoint rejects refresh tokens** as Bearer (`typ` must be `"access"`). Refresh tokens only fly to `/oauth/token`.
- **To invalidate all tokens**: rotate `JWT_SECRET` in Vercel env and redeploy. No per-token revocation (acceptable for personal use).

## Environment

Required Vercel env vars (production scope):

| Var | Purpose |
|---|---|
| `JWT_SECRET` | HS256 signing for all OAuth tokens. Long random string. |
| `ACCESS_PASSWORD` | Typed by the user in the consent screen to grant access to a new MCP client. |

There is intentionally **no `MCP_SECRET`** anymore (was the pre-OAuth bearer; removed in v0.7.0).

Read secrets from a password manager — they are not committed and not echoed in this file.

## Versioning & deploy

Server version lives in `src/server.js` (`new McpServer({ version: "..." })`). Bump it for every meaningful change so clients see the new build in `initialize`'s response.

Vercel deploys via CLI: `vercel deploy --prod --yes`. The `YOUR_DOMAIN` alias updates automatically on every prod deploy.

## When working on this repo

- For Aerolíneas API behavior changes (new fields, new option codes), inspect raw responses with a Node one-liner against `src/api.js` `searchOffers()` — do NOT trust assumptions.
- For OAuth or auth changes, do a full end-to-end flow with curl + a PKCE pair before committing. The end-to-end script pattern is: register → authorize → token → MCP initialize.
- For markdown formatting changes (`src/format.js`), eyeball the output locally; broken markdown shows up as ugly text in claude.ai with no error.
- Bump the MCP server `version` even for tiny changes; it's how you confirm clients picked up the new build.
