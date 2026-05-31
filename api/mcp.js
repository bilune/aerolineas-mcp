import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { buildServer } from "../src/server.js";
import { verifyToken, serverOrigin, setCors } from "../src/oauth.js";

export const config = { runtime: "nodejs" };

function unauthorized(res, req, description) {
  const base = serverOrigin(req);
  const resourceMeta = `${base}/.well-known/oauth-protected-resource`;
  res.statusCode = 401;
  res.setHeader("content-type", "application/json");
  res.setHeader(
    "www-authenticate",
    `Bearer realm="MCP", resource_metadata="${resourceMeta}"${
      description ? `, error="invalid_token", error_description="${description}"` : ""
    }`,
  );
  res.end(
    JSON.stringify({
      error: "unauthorized",
      ...(description ? { error_description: description } : {}),
    }),
  );
}

function checkAuth(req) {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return { ok: false, reason: "missing token" };
  try {
    const payload = verifyToken(match[1]);
    if (payload.typ && payload.typ !== "access") {
      return { ok: false, reason: "wrong token type" };
    }
    return { ok: true, payload };
  } catch (err) {
    return { ok: false, reason: String(err.message || err) };
  }
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

function toWebRequest(req, body) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost";
  const url = `${proto}://${host}${req.url}`;
  const init = { method: req.method, headers: req.headers };
  if (req.method !== "GET" && req.method !== "HEAD" && body.length) {
    init.body = body;
    init.duplex = "half";
  }
  return new Request(url, init);
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  const auth = checkAuth(req);
  if (!auth.ok) {
    return unauthorized(res, req, auth.reason);
  }

  const body = await readBody(req);
  const request = toWebRequest(req, body);

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const server = buildServer();
  await server.connect(transport);

  let response;
  try {
    response = await transport.handleRequest(request);
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: String(err?.message || err) }));
    return;
  } finally {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  }

  res.statusCode = response.status;
  response.headers.forEach((v, k) => res.setHeader(k, v));
  const buf = Buffer.from(await response.arrayBuffer());
  res.end(buf);
}
