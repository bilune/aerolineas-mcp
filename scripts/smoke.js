import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const child = spawn("node", [resolve(ROOT, "src/index.js")], {
  stdio: ["pipe", "pipe", "inherit"],
});

let buf = "";
const pending = new Map();
let nextId = 1;

child.stdout.on("data", (chunk) => {
  buf += chunk.toString("utf8");
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      console.error("non-json:", line);
      continue;
    }
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

function rpc(method, params) {
  const id = nextId++;
  return new Promise((res) => {
    pending.set(id, res);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

const init = await rpc("initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "smoke", version: "0.0.0" },
});
console.log("initialize:", init.result?.serverInfo);

child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

const tools = await rpc("tools/list", {});
console.log("tools:", tools.result.tools.map((t) => t.name));

const status = await rpc("tools/call", {
  name: "token_status",
  arguments: { refresh: false },
});
console.log("token_status:", status.result.content[0].text);

const offers = await rpc("tools/call", {
  name: "search_flights",
  arguments: {
    legs: [
      { origin: "BHI", destination: "AEP", date: "2026-05-30" },
      { origin: "AEP", destination: "BHI", date: "2026-06-20" },
    ],
    adt: 1,
    flexDates: true,
  },
});
const text = offers.result?.content?.[0]?.text ?? "";
console.log("offers bytes:", text.length);
try {
  const parsed = JSON.parse(text);
  console.log("offers keys:", Object.keys(parsed));
  console.log("shoppingId:", parsed.searchMetadata?.shoppingId);
} catch {
  console.log("offers (truncated):", text.slice(0, 400));
}

child.kill();
