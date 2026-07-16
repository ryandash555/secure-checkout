// Secure relay: receives the client's bank details, looks up the link to find the
// owning agent, and posts the submission into THAT agent's Jotform via the API.
// API keys stay server-side (env for the owner, "agents" store for other agents).
//
// Owner env variables:
//   JOTFORM_API_KEY, (optional) JOTFORM_FORM_ID, (optional) JOTFORM_API_BASE

import { connectLambda, getStore } from "@netlify/blobs";

const OWNER_FORM_ID = "261965412149057";
const OWNER_QID = { type: 2, routing: 3, account: 4, info: 5 };

function json(statusCode, obj) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) };
}

function money(n) {
  n = String(n).replace(/[^0-9.]/g, "");
  if (!n) return "";
  const o = { minimumFractionDigits: n.indexOf(".") > -1 ? 2 : 0, maximumFractionDigits: 2 };
  return "$" + Number(n).toLocaleString("en-US", o);
}

function buildInfo(o) {
  const parts = [];
  if (o.name) parts.push("Client: " + o.name);
  if (o.coverage) parts.push("Coverage: " + money(o.coverage));
  if (o.premium) parts.push("Premium: " + money(o.premium) + "/mo");
  let bens = [];
  if (Array.isArray(o.beneficiaries)) bens = o.beneficiaries;
  else if (o.beneficiary) bens = [o.beneficiary];
  if (bens.length) parts.push("Beneficiaries: " + bens.join("; "));
  return parts.join("  |  ").slice(0, 900);
}

async function agentCreds(agentId) {
  if (!agentId || agentId === "owner") {
    return {
      apiKey: process.env.JOTFORM_API_KEY,
      formId: process.env.JOTFORM_FORM_ID || OWNER_FORM_ID,
      apiBase: process.env.JOTFORM_API_BASE || "https://api.jotform.com",
      qid: OWNER_QID,
    };
  }
  const agents = getStore({ name: "agents", consistency: "strong" });
  const raw = await agents.get(String(agentId));
  if (!raw) return null;
  const a = JSON.parse(raw);
  return {
    apiKey: a.jotformApiKey,
    formId: a.formId,
    apiBase: a.apiBase || "https://api.jotform.com",
    qid: a.qid || OWNER_QID,
  };
}

export const handler = async (event) => {
  connectLambda(event);
  if (event.httpMethod !== "POST") return json(405, { ok: false, error: "Method not allowed" });

  let d;
  try { d = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { ok: false, error: "Bad request" }); }

  const type = String(d.type || "").trim();
  const routing = String(d.routing || "").replace(/\D/g, "");
  const account = String(d.account || "").replace(/\D/g, "");
  if (!type) return json(400, { ok: false, error: "Missing account type" });
  if (!/^\d{9}$/.test(routing)) return json(400, { ok: false, error: "Routing number must be 9 digits" });
  if (!/^\d{8,17}$/.test(account)) return json(400, { ok: false, error: "Account number must be 8 to 17 digits" });

  // Find the link -> owning agent + stored client details.
  let stored = null;
  if (d.code) {
    try { const links = getStore({ name: "client-links", consistency: "strong" }); const raw = await links.get(String(d.code)); if (raw) stored = JSON.parse(raw); } catch (e) {}
  }
  const agentId = stored && stored.agent ? stored.agent : "owner";
  const creds = await agentCreds(agentId);
  if (!creds || !creds.apiKey) return json(500, { ok: false, error: "Server not configured for this agent" });

  const info = stored ? buildInfo(stored) : String(d.info || "").slice(0, 900);
  const QID = creds.qid;

  const params = new URLSearchParams();
  params.append(`submission[${QID.type}]`, type);
  params.append(`submission[${QID.routing}]`, routing);
  params.append(`submission[${QID.account}]`, account);
  params.append(`submission[${QID.info}]`, info);

  try {
    const resp = await fetch(`${creds.apiBase}/form/${creds.formId}/submissions?apiKey=${encodeURIComponent(creds.apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const text = await resp.text();
    if (!resp.ok) return json(502, { ok: false, error: "Jotform rejected the submission", detail: text.slice(0, 300) });
    return json(200, { ok: true });
  } catch (e) {
    return json(502, { ok: false, error: "Could not reach Jotform", detail: String(e && e.message) });
  }
};
