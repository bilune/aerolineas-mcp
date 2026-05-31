// OAuth Authorization Server metadata (RFC 8414).
// Routed via vercel.json from /.well-known/oauth-authorization-server.

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
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256", "plain"],
    scopes_supported: [SCOPE],
  });
}
