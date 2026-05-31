// Dynamic Client Registration (RFC 7591). Stateless: we don't store client info;
// we issue an opaque client_id that's just a random UUID. The token endpoint
// doesn't verify the client_id beyond presence (single-resource personal MCP).

import crypto from "node:crypto";
import {
  readBody,
  safeJSON,
  setCors,
  sendJSON,
  oauthError,
  SCOPE,
} from "../../src/oauth.js";

export const config = { runtime: "nodejs" };

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end();
  }

  const body = safeJSON(await readBody(req)) ?? {};
  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
  if (!redirectUris.length) {
    return oauthError(res, 400, "invalid_redirect_uri", "redirect_uris required");
  }

  const clientId = crypto.randomUUID();
  const nowSec = Math.floor(Date.now() / 1000);

  return sendJSON(res, 201, {
    client_id: clientId,
    client_id_issued_at: nowSec,
    redirect_uris: redirectUris,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code"],
    response_types: ["code"],
    scope: SCOPE,
    client_name: body.client_name ?? null,
    client_uri: body.client_uri ?? null,
  });
}
