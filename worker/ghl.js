// Thin GoHighLevel client -- reused from Revinetic's own GHL account per
// explicit instruction, not a separate FHG Command integration. Used only
// to email the weekly 2FA verification code.

async function ghlFetch(env, path, { method = "GET", body, version = "2021-07-28" } = {}) {
  const response = await fetch(`${env.GHL_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.GHL_API_KEY}`,
      Version: version,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`GHL API error (${response.status}): ${text.slice(0, 200)}`);
  }
  return response.json();
}

export async function ghlUpsertContact(env, { email, name }) {
  const data = await ghlFetch(env, "/contacts/upsert", {
    method: "POST",
    body: { locationId: env.GHL_LOCATION_ID, email, name, source: "FHG Command" },
  });
  return data.contact.id;
}

export async function ghlSendEmail(env, { contactId, subject, html }) {
  return ghlFetch(env, "/conversations/messages", {
    method: "POST",
    version: "2021-04-15",
    body: { type: "Email", contactId, subject, html },
  });
}
