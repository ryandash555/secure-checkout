// Creates a short code for a client's policy details and stores it.
// Called by your private link-builder. Protected by AGENT_KEY so only you can use it.
//
// Required Netlify environment variable:
//   AGENT_KEY  -> a password only you know (also pasted into your local link-builder.html)

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
  const alphabet = "23456789abcdefghjkmnpqrstuvwxyz";
  let s = "";
  for (let i = 0; i < 6; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

export const handler = async (event) => {
  connectLambda(event);
  if (event.httpMethod === "OPTIONS") return json(200, {});
  if (event.httpMethod !== "POST") return json(405, { ok: false, error: "Method not allowed" });

  const AGENT_KEY = process.env.AGENT_KEY;
  if (!AGENT_KEY) return json(500, { ok: false, error: "Server not configured (missing AGENT_KEY)" });

  let d;
  try { d = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { ok: false, error: "Bad request" }); }
  if (d.agentKey !== AGENT_KEY) return json(401, { ok: false, error: "Not authorized" });

  const details = (d.details && typeof d.details === "object") ? d.details : {};
  const store = getStore("client-links");

  let code;
  for (let attempt = 0; attempt < 6; attempt++) {
    code = makeCode();
    const existing = await store.get(code);
    if (!existing) break;
  }
  await store.set(code, JSON.stringify(details));

  return json(200, { ok: true, code });
};
