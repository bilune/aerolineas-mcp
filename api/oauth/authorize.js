// Authorization endpoint. GET shows the consent screen; POST verifies the
// password, issues a short-lived `code` JWT, and redirects back to the client
// with `code` + `state`.

import {
  readBody,
  parseForm,
  setCors,
  issueCode,
  serverOrigin,
} from "../../src/oauth.js";

export const config = { runtime: "nodejs" };

const REQUIRED = [
  "response_type",
  "client_id",
  "redirect_uri",
  "code_challenge",
];

function htmlEscape(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderConsent(params, error) {
  const fields = [
    "response_type",
    "client_id",
    "redirect_uri",
    "scope",
    "state",
    "code_challenge",
    "code_challenge_method",
    "resource",
  ]
    .map(
      (k) =>
        `<input type="hidden" name="${k}" value="${htmlEscape(params[k] ?? "")}">`,
    )
    .join("\n");

  const errorHtml = error
    ? `<p style="color:#c00;margin:1rem 0">${htmlEscape(error)}</p>`
    : "";

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Flight Search MCP — Authorize</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; background:#f5f5f7; margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:2rem; }
    .card { background:#fff; border-radius:12px; padding:2rem; max-width:420px; width:100%; box-shadow: 0 4px 24px rgba(0,0,0,.08); }
    h1 { margin:0 0 .5rem; font-size:1.25rem; }
    p { color:#555; line-height:1.5; margin:.5rem 0 1.25rem; }
    code { background:#eee; padding:.1rem .35rem; border-radius:4px; font-size:.9em; }
    label { display:block; font-size:.9rem; color:#333; margin-bottom:.35rem; }
    input[type=password] { width:100%; padding:.6rem .75rem; border:1px solid #ccc; border-radius:8px; font-size:1rem; box-sizing:border-box; }
    button { margin-top:1rem; width:100%; padding:.75rem; border:none; border-radius:8px; background:#0066ff; color:#fff; font-size:1rem; font-weight:500; cursor:pointer; }
    button:hover { background:#0052cc; }
    .meta { font-size:.8rem; color:#888; margin-top:1.5rem; }
  </style>
</head>
<body>
  <form class="card" method="POST">
    <h1>Authorize access</h1>
    <p>An MCP client is requesting access to your flight search server.</p>
    <p>Client: <code>${htmlEscape(params.client_id ?? "")}</code></p>
    ${errorHtml}
    <label for="pw">Access password</label>
    <input id="pw" type="password" name="password" autofocus required>
    ${fields}
    <button type="submit">Authorize</button>
    <div class="meta">Scope: ${htmlEscape(params.scope ?? "mcp")}</div>
  </form>
</body>
</html>`;
}

function renderError(message) {
  return `<!doctype html><meta charset="utf-8"><title>Error</title>
<body style="font-family:system-ui;padding:2rem;color:#c00">
<h1>Authorization error</h1><p>${htmlEscape(message)}</p></body>`;
}

function htmlResponse(res, status, html) {
  res.statusCode = status;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(html);
}

function redirectWith(res, redirectUri, params) {
  const url = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, v);
  }
  res.statusCode = 302;
  res.setHeader("location", url.toString());
  res.end();
}

function getParams(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const url = new URL(req.url, `${proto}://${host}`);
  const out = {};
  for (const [k, v] of url.searchParams) out[k] = v;
  return out;
}

export default async function handler(req, res) {
  setCors(res);

  let params;
  let isPost = false;
  if (req.method === "GET") {
    params = getParams(req);
  } else if (req.method === "POST") {
    isPost = true;
    const body = await readBody(req);
    params = parseForm(body);
  } else {
    res.statusCode = 405;
    return res.end();
  }

  for (const key of REQUIRED) {
    if (!params[key]) {
      return htmlResponse(res, 400, renderError(`Missing required param: ${key}`));
    }
  }
  if (params.response_type !== "code") {
    return htmlResponse(
      res,
      400,
      renderError(`Unsupported response_type: ${params.response_type}`),
    );
  }

  if (!isPost) {
    return htmlResponse(res, 200, renderConsent(params, null));
  }

  // POST: verify password.
  const expected = process.env.ACCESS_PASSWORD;
  if (!expected) {
    return htmlResponse(
      res,
      500,
      renderError("ACCESS_PASSWORD env var not configured on server."),
    );
  }
  if (params.password !== expected) {
    return htmlResponse(res, 401, renderConsent(params, "Wrong password."));
  }

  const code = issueCode({
    sub: "mcp-user",
    iss: serverOrigin(req),
    client_id: params.client_id,
    redirect_uri: params.redirect_uri,
    code_challenge: params.code_challenge,
    code_challenge_method: params.code_challenge_method ?? "S256",
    scope: params.scope ?? "mcp",
    resource: params.resource ?? null,
  });

  return redirectWith(res, params.redirect_uri, {
    code,
    state: params.state,
  });
}
