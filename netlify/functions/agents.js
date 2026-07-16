// Admin API for managing agents. Gated by ADMIN_KEY (env). Stores each agent's
// name, Jotform API key, form ID, and detected field mapping in the "agents" store.
// Actions: list, add, remove.

import { connectLambda, getStore } from "@netlify/blobs";

function json(statusCode, obj) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
    body: JSON.stringify(obj),
  };
}

function makeKey() {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < 20; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

function mask(k) {
  k = String(k || "");
  return k.length <= 4 ? "****" : k.slice(0, 2) + "…" + k.slice(-2);
}

// Read the agent's Jotform form and map our 4 fields to their question IDs.
async function detectQid(apiBase, apiKey, formId) {
  const def = { type: 2, routing: 3, account: 4, info: 5 };
  try {
    const r = await fetch(`${apiBase}/form/${formId}/questions?apiKey=${encodeURIComponent(apiKey)}`);
    const j = await r.json();
    const q = (j && j.content) || {};
    const entries = Object.keys(q).map((k) => ({
      qid: k,
      text: String(q[k].text || "").toLowerCase(),
      order: parseInt(q[k].order || "999", 10),
      type: String(q[k].type || ""),
    })).sort((a, b) => a.order - b.order);

    const map = { type: null, routing: null, account: null, info: null };
    entries.forEach((e) => {
      if (map.type === null && /account type/.test(e.text)) map.type = e.qid;
      else if (map.routing === null && /routing/.test(e.text)) map.routing = e.qid;
      else if (map.account === null && /account number/.test(e.text)) map.account = e.qid;
      else if (map.info === null && /(client|coverage|premium|name|detail)/.test(e.text)) map.info = e.qid;
    });

    const boxes = entries.filter((e) => /textbox|textarea/.test(e.type));
    let bi = 0;
    ["type", "routing", "account", "info"].forEach((k) => {
      if (map[k] === null) {
        while (bi < boxes.length && Object.values(map).indexOf(boxes[bi].qid) >= 0) bi++;
        if (bi < boxes.length) { map[k] = boxes[bi].qid; bi++; }
      }
    });

    return {
      type: parseInt(map.type, 10) || def.type,
      routing: parseInt(map.routing, 10) || def.routing,
      account: parseInt(map.account, 10) || def.account,
      info: parseInt(map.info, 10) || def.info,
    };
  } catch (e) {
    return def;
  }
}

export const handler = async (event) => {
  connectLambda(event);
  if (event.httpMethod === "OPTIONS") return json(200, {});
  if (event.httpMethod !== "POST") return json(405, { ok: false, error: "Method not allowed" });

  const ADMIN = process.env.ADMIN_KEY;
  if (!ADMIN) return json(500, { ok: false, error: "Server not configured (missing ADMIN_KEY)" });

  let d;
  try { d = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { ok: false, error: "Bad request" }); }
  if (d.adminKey !== ADMIN) return json(401, { ok: false, error: "Not authorized" });

  const agents = getStore({ name: "agents", consistency: "strong" });
  const action = d.action;

  if (action === "list") {
    const out = [];
    const listing = await agents.list();
    for (const b of (listing.blobs || [])) {
      const raw = await agents.get(b.key);
      if (raw) { const a = JSON.parse(raw); out.push({ agentKey: b.key, name: a.name, formId: a.formId, apiKeyMasked: mask(a.jotformApiKey) }); }
    }
    return json(200, { ok: true, agents: out });
  }

  if (action === "add") {
    const name = String(d.name || "").trim();
    const jotformApiKey = String(d.jotformApiKey || "").trim();
    const formId = String(d.formId || "").trim();
    const apiBase = String(d.apiBase || "").trim() || "https://api.jotform.com";
    const agentKey = String(d.agentKey || "").trim() || makeKey();
    if (!name || !jotformApiKey || !formId) return json(400, { ok: false, error: "Name, Jotform API key, and form ID are required" });
    const qid = await detectQid(apiBase, jotformApiKey, formId);
    await agents.set(agentKey, JSON.stringify({ name, jotformApiKey, formId, apiBase, qid }));
    return json(200, { ok: true, agentKey, qid });
  }

  if (action === "remove") {
    const agentKey = String(d.agentKey || "").trim();
    if (!agentKey) return json(400, { ok: false, error: "Missing agentKey" });
    await agents.delete(agentKey);
    return json(200, { ok: true });
  }

  return json(400, { ok: false, error: "Unknown action" });
};
