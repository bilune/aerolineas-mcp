# Aerolíneas Argentinas MCP

A Model Context Protocol server that lets AI assistants (Claude Code, claude.ai, any MCP-compatible client) search Aerolíneas Argentinas flight offers, compare fare brands, and generate deep-links to buy tickets.

**Not affiliated with, endorsed by, or sponsored by Aerolíneas Argentinas.** Personal-use project that talks to the same public `api.aerolineas.com.ar` endpoint the airline's website uses.

## What it can do

- **Search by date or by window**: ask "BHI ↔ AEP cheapest in July with stay 5–15 days, must include carry-on" — the server explores combinations and returns the best ones.
- **Honest brand inclusions**: `enabled: true` in Aerolíneas' fare rules does NOT mean "included for free" (that bit me; it's documented now). The server normalizes each option to `free | paid | unavailable` so the LLM doesn't get fooled.
- **Buy-now links**: every result comes with a `bookingUrl` pre-filled with shoppingId and legs — one click takes the user straight to checkout.
- **Reference catalogs as MCP resources**: brands, fare-option codes, cabin classes, common airports — the LLM can read once per session and stop guessing.
- **Markdown-rendered output**: tool responses come as readable tables for the LLM and as typed JSON (`structuredContent`) for clients that render structured data.

## Tools

| Tool | Use it for |
|---|---|
| `find_best_combinations` | Best round-trip combos within a date window, filtered by required brand options (CARRY_ON, CHECKED_BAGGAGE…). |
| `search_flights` | Flex calendar (30 days per leg) or branded fares for an exact date. Lean by default; `include` for more detail. |
| `get_fare_rules` | Full per-brand option matrix when the reference resources aren't enough. |
| `token_status` | Inspect the cached upstream auth token. Debug only. |

## Architecture in 30 seconds

- Vercel serverless functions, Node runtime, no DB.
- OAuth 2.0 with PKCE, Dynamic Client Registration, refresh tokens. Stateless — tokens are HS256 JWTs signed with `JWT_SECRET`.
- Consent screen gated by `ACCESS_PASSWORD` (you type it once when adding the connector; the refresh-token rotation keeps it alive for ~90 days).
- Upstream API auth (Aerolíneas' own bearer token) is scraped and cached server-side per cold start.

See [CLAUDE.md](./CLAUDE.md) for the deep-dive (file map, gotchas, OAuth design, Vercel quirks).

## Deploy your own

You need a [Vercel](https://vercel.com) account.

```bash
# 1. Clone and install
git clone https://github.com/YOUR_GH/aerolineas-mcp.git
cd aerolineas-mcp
npm install

# 2. Fetch the Aerolíneas favicon (not redistributed; downloaded at setup time)
npm run fetch-favicon

# 3. Generate secrets
openssl rand -hex 32       # use as JWT_SECRET
openssl rand -base64 18    # use as ACCESS_PASSWORD (or pick your own)

# 4. Link to a Vercel project
vercel link

# 5. Set env vars in production
vercel env add JWT_SECRET production
vercel env add ACCESS_PASSWORD production

# 6. Deploy
vercel deploy --prod --yes
```

**Important**: in the Vercel project settings, **disable Deployment Protection** (or set it to "Only Preview Deployments"). The OAuth discovery endpoints (`/.well-known/*`) must be publicly reachable. Authentication is enforced at the application layer.

(Optional) Add a custom domain in Vercel and update `serverInfo.icons[0].src` in `src/server.js` if you want the data-URI fallback to use your own URL.

## Connect to claude.ai

1. claude.ai → Settings → Connectors → Add custom connector.
2. URL: `https://YOUR_DOMAIN/api/mcp`.
3. Authorize → consent screen → type your `ACCESS_PASSWORD`.
4. Tools become available in the chat.

## Connect to Claude Code (CLI)

```bash
claude mcp add --transport http aerolineas https://YOUR_DOMAIN/api/mcp
```

Claude Code will walk through the OAuth flow the same way.

## Try it

> "Find me the cheapest BHI ↔ AEP round trip in July 2026, stay between 5 and 15 days, must include carry-on. Give me the top 3 with buy links."

The server returns a markdown table with dates, flight numbers, the brand (it'll be `EP Plus` or higher because carry-on is paid on Base), the total in ARS, and a `bookingUrl` per row.

## Development

```bash
npm run smoke          # MCP smoke test over stdio
npm run smoke:http     # MCP smoke test over HTTP (no auth)
```

For OAuth-flow testing, see CLAUDE.md.

Local env vars when running outside Vercel:

```bash
export JWT_SECRET="anything-long-and-random"
export ACCESS_PASSWORD="anything"
```

## License

MIT for the code. The Aerolíneas Argentinas trademark, logo (favicon), and the underlying API are property of Aerolíneas Argentinas — used here for personal MCP integration without endorsement.
