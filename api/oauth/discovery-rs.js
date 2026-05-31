// OAuth Protected Resource metadata (RFC 9728).
// Routed via vercel.json from /.well-known/oauth-protected-resource.

import { serverOrigin, sendJSON, setCors, SCOPE } from "../../src/oauth.js";

export const config = { runtime: "nodejs" };

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== "GET") {
    res.statusCode = 405;
    return res.end();
  }
  const base = serverOrigin(req);
  return sendJSON(res, 200, {
    resource: `${base}/api/mcp`,
    authorization_servers: [base],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: process.env.OAUTH_RESOURCE_NAME || "Flight Search MCP",
  });
}
