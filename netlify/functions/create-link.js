// Creates a short code for a client's policy details and stores it, tagged with
// the owning agent. Accepts either the owner's AGENT_KEY (env) or any registered
// agent's key (from the "agents" store, managed via the admin page).

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

function makeCode() {
  const a = "23456789abcdefghjkmnpqrstuvwxyz";
  let s = "";
  for (let i = 0; i < 6; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

export const handler = async (event) => {
  connectLambda(event);
  if (event.httpMethod === "OPTIONS") return json(200, {});
  if (event.httpMethod !== "POST") return json(405, { ok: false, error: "Method not allowed" });

  let d;
  try { d = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { ok: false, error: "Bad request" }); }
  const agentKey = String(d.agentKey || "");
  if (!agentKey) return json(401, { ok: false, error: "Not authorized" });

  // Which agent owns this link? The env owner key, or a registered agent.
  let agentId = null;
  if (process.env.AGENT_KEY && agentKey === process.env.AGENT_KEY) {
    agentId = "owner";
  } else {
    const agents = getStore({ name: "agents", consistency: "strong" });
    const rec = await agents.get(agentKey);
    if (rec) agentId = agentKey;
  }
  if (!agentId) return json(401, { ok: false, error: "Not authorized" });

  const details = (d.details && typeof d.details === "object") ? d.details : {};
  details.agent = agentId;

  const links = getStore("client-links");
  let code;
  for (let i = 0; i < 6; i++) { code = makeCode(); if (!(await links.get(code))) break; }
  await links.set(code, JSON.stringify(details));

  return json(200, { ok: true, code });
};
