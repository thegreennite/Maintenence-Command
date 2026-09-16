// Weekly email 2FA. Every account needs it, but only once every 7 days --
// not on every single login -- per explicit spec.

import { ghlUpsertContact, ghlSendEmail } from "./ghl.js";
import { createSessionToken } from "./security.js";

const CODE_TTL_MINUTES = 10;
const VERIFICATION_VALID_DAYS = 7;

export function needsVerification(user) {
  if (!user.last_2fa_verified_at) return true;
  const ageMs = Date.now() - new Date(user.last_2fa_verified_at + "Z").getTime();
  return ageMs > VERIFICATION_VALID_DAYS * 24 * 60 * 60 * 1000;
}

// `db` is the resolved company database (FHG's native binding, or the
// HTTP-routed one for any other company) -- resolved by the caller
// (handleLogin/handleVerifyCode in index.js) since a pending 2FA token
// alone doesn't say which company it belongs to; the caller encodes
// that into the token it hands back to the frontend instead.
export async function sendVerificationCode(env, db, user) {
  const code = String(Math.floor(100_000 + Math.random() * 900_000));
  const pendingToken = createSessionToken();
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000).toISOString();

  await db.prepare(
    "INSERT INTO two_factor_codes (user_id, code, pending_token, expires_at) VALUES (?, ?, ?, ?)",
  )
    .bind(user.id, code, pendingToken, expiresAt)
    .run();

  let contactId = user.ghl_contact_id;
  if (!contactId) {
    contactId = await ghlUpsertContact(env, { email: user.username.includes("@") ? user.username : user.email, name: user.full_name });
    await db.prepare("UPDATE users SET ghl_contact_id = ? WHERE id = ?").bind(contactId, user.id).run();
  }

  await ghlSendEmail(env, {
    contactId,
    subject: "Your FHG Command verification code",
    html: `<p>Hi ${user.full_name},</p><p>Your FHG Command verification code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:4px;">${code}</p><p>This code expires in ${CODE_TTL_MINUTES} minutes. If you didn't request this, you can ignore it.</p>`,
  });

  return pendingToken;
}

export async function verifyCode(db, pendingToken, code) {
  const row = await db.prepare(
    "SELECT id, user_id, code, expires_at FROM two_factor_codes WHERE pending_token = ?",
  )
    .bind(pendingToken)
    .first();

  if (!row) return { ok: false, error: "That verification link has expired. Sign in again." };
  if (new Date(row.expires_at + "Z").getTime() < Date.now()) {
    await db.prepare("DELETE FROM two_factor_codes WHERE id = ?").bind(row.id).run();
    return { ok: false, error: "That code has expired. Sign in again to get a new one." };
  }
  if (row.code !== String(code).trim()) {
    return { ok: false, error: "That code doesn't match. Try again." };
  }

  await db.batch([
    db.prepare("DELETE FROM two_factor_codes WHERE id = ?").bind(row.id),
    db.prepare("UPDATE users SET last_2fa_verified_at = CURRENT_TIMESTAMP WHERE id = ?").bind(row.user_id),
  ]);

  return { ok: true, userId: row.user_id };
}
