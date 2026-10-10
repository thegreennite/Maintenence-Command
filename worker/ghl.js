// Thin GoHighLevel client -- reused from Revinetic's own GHL account per
// explicit instruction, not a separate Inspect N Snap integration. Used only
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
    body: { locationId: env.GHL_LOCATION_ID, email, name, source: "Inspect N Snap" },
  });
  return data.contact.id;
}

// `attachments` is a list of publicly fetchable URLs -- GHL pulls each
// one and attaches the file to the email.
export async function ghlSendEmail(env, { contactId, subject, html, attachments }) {
  return ghlFetch(env, "/conversations/messages", {
    method: "POST",
    version: "2021-04-15",
    body: { type: "Email", contactId, subject, html, ...(attachments?.length ? { attachments } : {}) },
  });
}

// SMS goes out from whatever phone number is actually provisioned on
// this location's Conversations/Phone settings inside GHL itself --
// that part is a GHL account setting, not something an API call can
// pick or change. This just sends through that connection once it
// exists; GHL replies with a real error if no number is set up yet.
export async function ghlSendSms(env, { contactId, message }) {
  return ghlFetch(env, "/conversations/messages", {
    method: "POST",
    version: "2021-04-15",
    body: { type: "SMS", contactId, message },
  });
}
