const encoder = new TextEncoder();

export function hexToBytes(hex) {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) {
    throw new Error("Invalid hexadecimal value");
  }

  return Uint8Array.from(hex.match(/.{2}/g), (byte) => Number.parseInt(byte, 16));
}

export function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyPassword(password, saltHex, expectedHashHex) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: hexToBytes(saltHex),
      // Cloudflare Workers' WebCrypto caps PBKDF2 at 100,000 iterations —
      // this must stay <= 100_000 or verifyPassword throws in production
      // even though it works fine locally under Miniflare/Node.
      iterations: 100_000,
    },
    key,
    256,
  );
  const actual = new Uint8Array(bits);
  const expected = hexToBytes(expectedHashHex);

  if (actual.length !== expected.length) return false;

  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) {
    difference |= actual[index] ^ expected[index];
  }
  return difference === 0;
}

export async function hashToken(token) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(token));
  return bytesToHex(new Uint8Array(digest));
}

export function createSessionToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export function readCookie(request, name) {
  const cookieHeader = request.headers.get("Cookie") || "";
  for (const part of cookieHeader.split(";")) {
    const [key, ...valueParts] = part.trim().split("=");
    if (key === name) return decodeURIComponent(valueParts.join("="));
  }
  return null;
}

export function sessionCookie(request, token, maxAgeSeconds) {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  const originHost = origin ? new URL(origin).hostname : url.hostname;
  const isSecure = url.protocol === "https:";
  const crossSite = originHost !== url.hostname;
  const parts = [
    `fhg_session=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    `Max-Age=${maxAgeSeconds}`,
    crossSite && isSecure ? "SameSite=None" : "SameSite=Lax",
  ];
  if (isSecure) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookie(request) {
  return sessionCookie(request, "", 0);
}
