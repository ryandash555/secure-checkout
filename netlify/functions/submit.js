// Secure relay: receives the client's bank details from your page (same-origin,
// so no CORS/spam issues) and creates a submission in your Jotform via the API.
// Your Jotform API key stays here on the server as an environment variable and is
// never exposed to the client.
//
// Required Netlify environment variable:
//   JOTFORM_API_KEY   -> from Jotform: Account > API > Create New Key (Full access)
// Optional:
//   JOTFORM_FORM_ID   -> defaults to your form below
//   JOTFORM_API_BASE  -> use https://eu-api.jotform.com if your account is EU-based

import { getStore } from "@netlify/blobs";

const FORM_ID_DEFAULT = "261965412149057";

// Maps to your form's question IDs (q2/q3/q4/q5).
const QID = { type: 2, routing: 3, account: 4, info: 5 };

function json(statusCode, obj) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) };
}

function money(n) {
  n = String(n).replace(/[^0-9.]/g, "");
  if (!n) return "";
  const opts = { minimumFractionDigits: n.indexOf(".") > -1 ? 2 : 0, maximumFractionDigits: 2 };
  return "$" + Number(n).toLocaleString("en-US", opts);
}

// Build the info string from stored client details (server-side, trustworthy).
async function infoFromCode(code) {
  try {
    const store = getStore("client-links");
    const raw = await store.get(String(code));
    if (!raw) return "";
    const o = JSON.parse(raw);
    const parts = [];
    if (o.name) parts.push("Client: " + o.name);
    if (o.coverage) parts.push("Coverage: " + money(o.coverage));
    if (o.premium) parts.push("Premium: " + money(o.premium) + "/mo");
    return parts.join("  |  ");
  } catch (e) {
    return "";
  }
}

export const handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { ok: false, error: "Method not allowed" });

  const KEY = process.env.JOTFORM_API_KEY;
  const FORM_ID = process.env.JOTFORM_FORM_ID || FORM_ID_DEFAULT;
  const API_BASE = process.env.JOTFORM_API_BASE || "https://api.jotform.com";
  if (!KEY) return json(500, { ok: false, error: "Server not configured (missing API key)" });

  let d;
  try { d = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { ok: false, error: "Bad request" }); }

  const type = String(d.type || "").trim();
  const routing = String(d.routing || "").replace(/\D/g, "");
  const account = String(d.account || "").replace(/\D/g, "");

  if (!type) return json(400, { ok: false, error: "Missing account type" });
  if (!/^\d{9}$/.test(routing)) return json(400, { ok: false, error: "Routing number must be 9 digits" });
  if (!/^\d{8,17}$/.test(account)) return json(400, { ok: false, error: "Account number must be 8 to 17 digits" });

  // Prefer server-resolved details from the short code; fall back to what the page sent.
  let info = "";
  if (d.code) info = await infoFromCode(d.code);
  if (!info) info = String(d.info || "").slice(0, 500);

  const params = new URLSearchParams();
  params.append(`submission[${QID.type}]`, type);
  params.append(`submission[${QID.routing}]`, routing);
  params.append(`submission[${QID.account}]`, account);
  params.append(`submission[${QID.info}]`, info);

  try {
    const resp = await fetch(`${API_BASE}/form/${FORM_ID}/submissions?apiKey=${encodeURIComponent(KEY)}`, {
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
