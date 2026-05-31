import { createServer } from "node:http";
import handler from "../api/mcp.js";

const PORT = 4321;

const server = createServer((req, res) => handler(req, res));

server.listen(PORT, async () => {
  console.log(`listening http://localhost:${PORT}`);
  try {
    await runClient(`http://localhost:${PORT}/`);
  } finally {
    server.close();
  }
});

let nextId = 1;
async function rpc(url, method, params) {
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
  });
  const text = await r.text();
  try {
    return { status: r.status, body: JSON.parse(text) };
  } catch {
    return { status: r.status, body: text };
  }
}

async function runClient(base) {
  const init = await rpc(base, "initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "http-smoke", version: "0" },
  });
  console.log("initialize:", init.status, init.body?.result?.serverInfo);

  const tools = await rpc(base, "tools/list", {});
  console.log("tools:", tools.body?.result?.tools?.map((t) => t.name));

  const status = await rpc(base, "tools/call", {
    name: "token_status",
    arguments: { refresh: false },
  });
  console.log("token_status:", status.body?.result?.content?.[0]?.text);

  const offers = await rpc(base, "tools/call", {
    name: "search_flights",
    arguments: {
      legs: [
        { origin: "BHI", destination: "AEP", date: "2026-05-30" },
        { origin: "AEP", destination: "BHI", date: "2026-06-20" },
      ],
    },
  });
  const text = offers.body?.result?.content?.[0]?.text ?? "";
  console.log("offers bytes:", text.length);
  try {
    const parsed = JSON.parse(text);
    console.log("shoppingId:", parsed.searchMetadata?.shoppingId);
  } catch {
    console.log("offers preview:", text.slice(0, 200));
  }
}
