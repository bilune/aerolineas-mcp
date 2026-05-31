# Flight Search MCP

OAuth-protected remote MCP server. Wraps an airline's flight inventory API and exposes it as MCP tools. Currently deployed for Aerolíneas Argentinas, but the code is API-agnostic (all upstream URLs + identity strings come from env vars).

## Quick start

```bash
npm install
cp .env.example .env       # fill in JWT_SECRET, ACCESS_PASSWORD, UPSTREAM_*
npm run smoke              # local MCP smoke test (stdio)
npm run smoke:http         # local MCP smoke test over HTTP (no auth)

# Deploy
vercel deploy --prod --yes

# Inspect prod
vercel inspect YOUR_DOMAIN --logs
vercel env ls production
```

## Architecture

```
api/                      Vercel serverless functions
  mcp.js                  MCP endpoint (validates Bearer JWT)
  oauth/
    discovery-as.js       /.well-known/oauth-authorization-server  (via rewrite)
    discovery-rs.js       /.well-known/oauth-protected-resource    (via rewrite)
    register.js           Dynamic Client Registration (RFC 7591)
    authorize.js          consent screen + auth-code issuance
    token.js              code → tokens, refresh_token rotation
src/
  config.js               env var loader (all upstream URLs and identity strings)
  server.js               McpServer setup, schemas, tools, resources
  api.js                  raw HTTP call to UPSTREAM_API_BASE
  token.js                upstream auth token scraping + caching
  transform.js            raw API payload → lean structured output
  combinations.js         find_best_combinations orchestrator
  format.js               markdown renderers for content[].text
  reference.js            static catalogs + serverInstructions template
  url.js                  booking deep-link builder (uses BOOKING_URL_BASE)
  oauth.js                JWT helpers, OAuth shared utils
  jwt.js                  HS256 sign/verify (no deps)
vercel.json               rewrites for /.well-known/* and /oauth/*
```

Tools exposed: `search_flights`, `get_fare_rules`, `find_best_combinations`, `token_status`.
Resources: `flightsearch://reference/{brands,fare-options,cabin-classes,airports}` (URI scheme configurable via `MCP_RESOURCE_URI_SCHEME`).

## Gotchas (real ones we hit)

### Upstream API semantics

- **`enabled: true` does NOT mean "included free"** in `fareRules`. The discriminator is `detail`:
  - `enabled: false` → option not in this brand
  - `enabled: true, detail: ""` or descriptive (`"Carry on de 8kg"`) → INCLUDED FREE
  - `enabled: true, detail: "Cargo extra"` / `"$ 40.000"` / `"Con 40% de retención"` → AVAILABLE BUT PAID
  - We compute `inclusion: "free" | "paid" | "unavailable"` in `extractFareRules`. Never filter on `enabled` alone.
- **Brand semantics (Aerolíneas-specific but typical industry pattern)**: EB Base only includes Personal_Item free; carry-on is paid. EP Plus is the cheapest with free carry-on. Business brands (BA/BI/BC) have all options as `unavailable` in fareRules — data is unreliable for Business; the brand reference resource has hand-curated truth.
- **Two response shapes** for the offers endpoint:
  - `flexDates: true` → `calendarOffers` (object keyed by leg index, ~30 days, one cheapest brand per day)
  - `flexDates: false` → `brandedOffers` (object keyed by leg index, one element per flight, multiple brands)
- **`combinableOffers`**: in branded responses, each offer carries the list of offer IDs from the other leg it can pair with. Use this for round-trip combos rather than assuming same-brand pairing.
- **Upstream requires real browser headers** (User-Agent, Origin, Referer, x-channel-id) — see `api.js`. Plain curl returns 403 from Azure Application Gateway.

### Vercel quirks

- **Deployment Protection must stay OFF** in production for `.well-known/*` discovery to be reachable by OAuth clients. Auth is enforced at the application layer (OAuth + JWT). Don't re-enable.
- **`api/.well-known/` does NOT work** as a folder (Vercel excludes dotfiles). All `/.well-known/*` URLs go through rewrites in `vercel.json` → `/api/oauth/discovery-*`.
- **OAuth public paths** (`/oauth/authorize`, `/oauth/token`, `/oauth/register`) are also rewrites to `/api/oauth/*`. Without these rewrites the discovery doc advertises endpoints that 404.

### Code traps

- **Backticks inside the `buildServerInstructions` template literal** in `reference.js` MUST be escaped (`\``). Otherwise Node parses them as nested template literals and the build dies with `SyntaxError: Unexpected identifier`. Vercel's prod logs are the only place this shows.
- **`McpServer` constructor** takes `(serverInfo, serverOptions)`. `instructions` goes in the second arg, `icons`/`websiteUrl`/`description` go in the first.
- **Tool `content[].text` vs `structuredContent`**: per MCP spec, text is the human-readable rendering (we use markdown for visible tools, JSON for technical ones). structuredContent is the typed object for clients and chained calls. Never duplicate JSON in both — wastes tokens. See `format.js` + `asStructured()` in `server.js`.

### OAuth design

- **Stateless JWT**, no database. Authorization codes are 60s JWTs encoding PKCE challenge + redirect URI. Access tokens are 24h with `typ: "access"`. Refresh tokens are 90d with `typ: "refresh"` and rotate on every use (sliding expiry).
- **MCP endpoint rejects refresh tokens** as Bearer (`typ` must be `"access"`). Refresh tokens only fly to `/oauth/token`.
- **To invalidate all tokens**: rotate `JWT_SECRET` in Vercel env and redeploy. No per-token revocation (acceptable for personal use).

## Environment

All deployment-specific values live in env vars. See `.env.example` for the full list and `src/config.js` for what's required vs optional.

| Var | Required | Purpose |
|---|---|---|
| `JWT_SECRET` | yes | HS256 signing for all OAuth tokens. |
| `ACCESS_PASSWORD` | yes | Typed in consent screen by the user. |
| `UPSTREAM_API_BASE` | yes | Base URL of upstream airline API (no trailing slash). |
| `UPSTREAM_WEB_ORIGIN` | yes | Origin/Referer value for upstream requests. |
| `UPSTREAM_TOKEN_URL` | yes | HTML page with `window.__ACCESS_TOKEN__` to scrape. |
| `UPSTREAM_OFFERS_PATH` | no | Defaults to `/v1/flights/offers`. |
| `UPSTREAM_CHANNEL_ID` | no | Defaults to `WEB`. |
| `UPSTREAM_LOCALE` | no | Defaults to `en-US`. |
| `UPSTREAM_USER_AGENT` | no | Defaults to a recent Chrome UA. |
| `BOOKING_URL_BASE` | no | If unset, `bookingUrl` fields return `null`. |
| `SERVER_NAME` / `SERVER_TITLE` / `SERVER_DESCRIPTION` / `SERVER_WEBSITE_URL` | no | Identity in `initialize`. |
| `OAUTH_RESOURCE_NAME` | no | Shown in OAuth protected-resource metadata. |
| `MCP_RESOURCE_URI_SCHEME` | no | URI scheme for resources (default `flightsearch`). |

## Versioning & deploy

Server version lives in `src/server.js` (`new McpServer({ ..., version: "..." })`). Bump it for every meaningful change so clients see the new build in `initialize`'s response.

Vercel deploys via CLI: `vercel deploy --prod --yes`. The production alias updates automatically on every prod deploy.

## When working on this repo

- For upstream API behavior changes (new fields, new option codes), inspect raw responses with a Node one-liner against `src/api.js` `searchOffers()` — do NOT trust assumptions.
- For OAuth or auth changes, do a full end-to-end flow with curl + a PKCE pair before committing. The pattern: register → authorize → token → MCP initialize.
- For markdown formatting changes (`src/format.js`), eyeball the output locally; broken markdown shows up as ugly text in claude.ai with no error.
- Bump the MCP server `version` even for tiny changes; it's how you confirm clients picked up the new build.
- Keep the public-source code airline-agnostic. Specific URLs, brand identity, and booking links belong in `.env`, not in source.
