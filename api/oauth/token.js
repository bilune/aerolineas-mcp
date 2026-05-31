// Token endpoint. Handles two grants:
//   - authorization_code: exchanges the auth code (JWT) for access + refresh tokens.
//   - refresh_token:      exchanges a refresh token for a fresh access token
//                         (rotates the refresh token too).

import {
  readBody,
  parseForm,
  setCors,
  sendJSON,
  oauthError,
  verifyToken,
  issueAccessToken,
  issueRefreshToken,
  verifyPkce,
  ACCESS_TTL_SEC,
  SCOPE,
} from "../../src/oauth.js";

export const config = { runtime: "nodejs" };

async function handleAuthorizationCode(params, res) {
  if (!params.code) {
    return oauthError(res, 400, "invalid_request", "code required");
  }
  if (!params.client_id) {
    return oauthError(res, 400, "invalid_request", "client_id required");
  }

  let codePayload;
  try {
    codePayload = verifyToken(params.code);
  } catch (err) {
    return oauthError(res, 400, "invalid_grant", String(err.message || err));
  }

  if (codePayload.client_id !== params.client_id) {
    return oauthError(res, 400, "invalid_grant", "client_id mismatch");
  }
  if (
    params.redirect_uri &&
    codePayload.redirect_uri !== params.redirect_uri
  ) {
    return oauthError(res, 400, "invalid_grant", "redirect_uri mismatch");
  }
  if (
    !verifyPkce(
      codePayload.code_challenge,
      codePayload.code_challenge_method,
      params.code_verifier,
    )
  ) {
    return oauthError(res, 400, "invalid_grant", "PKCE verification failed");
  }

  return issueTokens(codePayload, res);
}

async function handleRefreshToken(params, res) {
  if (!params.refresh_token) {
    return oauthError(res, 400, "invalid_request", "refresh_token required");
  }
  let payload;
  try {
    payload = verifyToken(params.refresh_token);
  } catch (err) {
    return oauthError(res, 400, "invalid_grant", String(err.message || err));
  }
  if (payload.typ !== "refresh") {
    return oauthError(res, 400, "invalid_grant", "not a refresh token");
  }
  if (params.client_id && payload.client_id !== params.client_id) {
    return oauthError(res, 400, "invalid_grant", "client_id mismatch");
  }
  return issueTokens(payload, res);
}

function issueTokens(claims, res) {
  const base = {
    sub: claims.sub ?? "mcp-user",
    iss: claims.iss ?? null,
    client_id: claims.client_id,
    scope: claims.scope ?? SCOPE,
    resource: claims.resource ?? null,
  };
  const access = issueAccessToken(base);
  const refresh = issueRefreshToken(base);
  return sendJSON(res, 200, {
    access_token: access,
    token_type: "Bearer",
    expires_in: ACCESS_TTL_SEC,
    refresh_token: refresh,
    scope: claims.scope ?? SCOPE,
  });
}

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

  const params = parseForm(await readBody(req));
  switch (params.grant_type) {
    case "authorization_code":
      return handleAuthorizationCode(params, res);
    case "refresh_token":
      return handleRefreshToken(params, res);
    default:
      return oauthError(
        res,
        400,
        "unsupported_grant_type",
        `grant_type ${params.grant_type ?? "(missing)"} not supported`,
      );
  }
}
