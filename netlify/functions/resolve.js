// Looks up a short code and returns the client's display details
// (name, coverage, premium, dates, beneficiary) so the checkout page can show them.

import { connectLambda, getStore } from "@netlify/blobs";

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify(obj),
  };
}

export const handler = async (event) => {
  connectLambda(event);
  const code = (event.queryStringParameters && event.queryStringParameters.code) || "";
  if (!/^[0-9a-z]{4,12}$/.test(code)) return json(400, { ok: false, error: "Bad code" });

  const store = getStore("client-links");
  const raw = await store.get(code);
  if (!raw) return json(404, { ok: false, error: "Not found" });

  return json(200, { ok: true, details: JSON.parse(raw) });
};
