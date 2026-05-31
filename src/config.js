// Runtime configuration. All deployment-specific values come from environment
// variables, with no airline-identifying defaults baked into the source. Set
// these in your Vercel project (or local .env) to point the wrapper at a
// specific upstream API. See .env.example for the full list.

function required(name) {
  const v = process.env[name];
  if (!v) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

function optional(name, fallback = "") {
  return process.env[name] ?? fallback;
}

export const config = {
  // Upstream HTTP API the MCP wraps. e.g. https://api.example.com
  upstreamApiBase: () => required("UPSTREAM_API_BASE"),

  // Path on the upstream API for the offers endpoint (relative to upstreamApiBase).
  upstreamOffersPath: () => optional("UPSTREAM_OFFERS_PATH", "/v1/flights/offers"),

  // Web origin used in Origin / Referer headers, e.g. https://www.example.com
  upstreamWebOrigin: () => required("UPSTREAM_WEB_ORIGIN"),

  // Channel ID header value the upstream expects (vendor-specific).
  upstreamChannelId: () => optional("UPSTREAM_CHANNEL_ID", "WEB"),

  // Accept-Language header value.
  upstreamLocale: () => optional("UPSTREAM_LOCALE", "en-US"),

  // URL of an HTML page on the upstream site that embeds the access token in
  // window.__ACCESS_TOKEN__ / window.__TOKEN_EXPIRATION__ (server-side scrape).
  upstreamTokenUrl: () => required("UPSTREAM_TOKEN_URL"),

  // User-Agent used for every request to the upstream.
  upstreamUserAgent: () =>
    optional(
      "UPSTREAM_USER_AGENT",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    ),

  // Public booking deep-link base, e.g. https://www.example.com/flights-offers
  bookingUrlBase: () => optional("BOOKING_URL_BASE", ""),

  // MCP server identity advertised in initialize / discovery.
  serverName: () => optional("SERVER_NAME", "flight-search-mcp"),
  serverTitle: () => optional("SERVER_TITLE", "Flight Search MCP"),
  serverDescription: () =>
    optional(
      "SERVER_DESCRIPTION",
      "MCP wrapper for an airline's public flight inventory API.",
    ),
  serverWebsiteUrl: () => optional("SERVER_WEBSITE_URL", ""),

  // OAuth Protected Resource metadata.
  oauthResourceName: () => optional("OAUTH_RESOURCE_NAME", "Flight Search MCP"),

  // MCP resources URI scheme. Keep it stable across redeploys (clients cache by URI).
  resourceUriScheme: () =>
    optional("MCP_RESOURCE_URI_SCHEME", "flightsearch"),
};
