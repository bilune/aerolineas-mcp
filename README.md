# Aerolíneas Argentinas MCP

An OAuth-protected [Model Context Protocol](https://modelcontextprotocol.io/) server that lets AI assistants (Claude Code, claude.ai, any MCP-compatible client) search **Aerolíneas Argentinas** flights, understand what each fare brand actually includes, and produce checkout deep-links.

It calls the same public `api.aerolineas.com.ar` endpoints the airline's own website uses (`aerolineas.com.ar`). No private APIs, no scraping of authenticated pages — just the same JSON the public flight search returns, exposed as well-typed MCP tools with sensible defaults for AI consumption (lean output, markdown summaries, structured JSON, branded inclusion semantics fixed).

**Not affiliated with, endorsed by, or sponsored by Aerolíneas Argentinas.** Personal project; use at your own discretion.

The source code itself is API-agnostic — upstream URLs, headers, and identity strings live in environment variables (`UPSTREAM_*`). Pointing it at another carrier with a similar Sabre-style backend is a matter of changing `.env`.

## What it does

- **Date-window search**: ask "BHI ↔ AEP cheapest in July with stay 5–15 days, must include carry-on" — the server explores combinations and returns the best ones.
- **Honest brand inclusions**: Aerolíneas' fare-rules API marks options as `enabled: true` even when they cost extra (e.g. Base says CARRY_ON is "enabled" but `detail: "Cargo extra"`). The server normalizes each option to `free | paid | unavailable` so the LLM never tells the user "Base includes carry-on" when it doesn't.
- **Buy-now links**: every result comes with a `bookingUrl` pre-filled with shoppingId and legs — one click takes the user straight to aerolineas.com.ar checkout.
- **Reference catalogs as MCP resources**: brands (EA Promo, EB Base, EP Plus, EF Flex, …), fare-option codes, cabin classes, Argentine cabotage airports — the LLM reads them once per session and stops guessing.
- **Markdown-rendered output**: tool responses come as readable tables for the LLM and as typed JSON (`structuredContent`) for clients that render structured data.

## Tools

| Tool | Use it for |
|---|---|
| `find_best_combinations` | Best round-trip combos within a date window, filtered by required brand options (CARRY_ON, CHECKED_BAGGAGE…). |
| `search_flights` | Flex calendar (~30 days per leg) or branded fares for an exact date. Lean by default; `include` for detail. |
| `get_fare_rules` | Full per-brand option matrix with the `inclusion` field per option. |
| `token_status` | Inspect the cached upstream auth token. Debug only. |

## Architecture in 30 seconds

- Vercel serverless functions, Node runtime, no DB.
- OAuth 2.0 with PKCE, Dynamic Client Registration, refresh tokens. Stateless — tokens are HS256 JWTs signed with `JWT_SECRET`.
- Consent screen gated by `ACCESS_PASSWORD` (you type it once per client; refresh-token rotation keeps it alive ~90 days).
- Upstream Aerolíneas API auth (their own bearer token) is scraped from a public HTML page on aerolineas.com.ar and cached server-side.

See [CLAUDE.md](./CLAUDE.md) for the deep-dive (file map, gotchas, OAuth design, Vercel quirks).

## Deploy your own

You need a [Vercel](https://vercel.com) account.

```bash
# 1. Clone and install
git clone https://github.com/YOUR_GH/flight-search-mcp.git
cd flight-search-mcp
npm install

# 2. Generate secrets
openssl rand -hex 32        # use as JWT_SECRET
openssl rand -base64 18     # use as ACCESS_PASSWORD (or pick your own)

# 3. Link to a Vercel project
vercel link

# 4. Configure env vars (see .env.example for the full list)
vercel env add JWT_SECRET production
vercel env add ACCESS_PASSWORD production
vercel env add UPSTREAM_API_BASE production       # e.g. https://api.aerolineas.com.ar
vercel env add UPSTREAM_WEB_ORIGIN production     # e.g. https://www.aerolineas.com.ar
vercel env add UPSTREAM_TOKEN_URL production      # public HTML page with window.__ACCESS_TOKEN__
vercel env add UPSTREAM_CHANNEL_ID production     # e.g. WEB_AR
vercel env add UPSTREAM_LOCALE production         # e.g. es-AR
vercel env add BOOKING_URL_BASE production        # e.g. https://www.aerolineas.com.ar/flights-offers

# 5. Deploy
vercel deploy --prod --yes
```

**Important**: in the Vercel project settings, **disable Deployment Protection** (or set it to "Only Preview Deployments"). The OAuth discovery endpoints (`/.well-known/*`) must be publicly reachable. Authentication is enforced at the application layer (OAuth + JWT).

### Why env-driven URLs

So the public source code stays a generic flight-search wrapper. The specific airline you point it at is a deployment-time decision, not a property of the code. Want to use this with a different airline that has a Sabre-style `flights/offers` endpoint? Just change the env vars.

## Connect to claude.ai

1. claude.ai → Settings → Connectors → Add custom connector.
2. URL: `https://YOUR_DOMAIN/api/mcp`.
3. Authorize → consent screen → type your `ACCESS_PASSWORD`.
4. Tools become available in the chat.

## Connect to Claude Code (CLI)

```bash
claude mcp add --transport http flightsearch https://YOUR_DOMAIN/api/mcp
```

Claude Code walks through the OAuth flow the same way.

## Try it

> "Find me the cheapest BHI ↔ AEP round trip in July 2026, stay 5–15 days, must include carry-on. Top 3 with buy links."

The server returns a markdown table with dates, flight numbers, the brand (it'll be `EP Plus` or higher because carry-on is only free from Plus up — not on Base, despite what the fareRules `enabled` flag suggests), the total in ARS, and a `bookingUrl` per row.

## Development

```bash
npm run smoke          # MCP smoke test over stdio
npm run smoke:http     # MCP smoke test over HTTP (no auth)
```

```bash
# Local env (don't commit)
cp .env.example .env
# fill in JWT_SECRET, ACCESS_PASSWORD, UPSTREAM_*
```

## License

MIT for the code. Aerolíneas Argentinas' trademarks, logos, branding, and API responses remain the property of Aerolíneas Argentinas. This repo does not redistribute any of their artwork or copyrighted content.
