/** Edge-safe session helpers (Web Crypto only). Single-user passcode auth; all data is still org-scoped. */
export const SESSION_COOKIE = "nexora_session";
export const SESSION_MAX_AGE = 60 * 60 * 12;

async function hmacHex(key: string, msg: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Token = issuedAt.hmac(passcode, issuedAt). Rotating the passcode invalidates all sessions. */
export async function createSessionToken(passcode: string, issuedAt = Date.now()): Promise<string> {
  return `${issuedAt}.${await hmacHex(passcode, `nexora-session-v1:${issuedAt}`)}`;
}

export async function verifySessionToken(token: string | undefined, passcode: string | undefined): Promise<boolean> {
  if (!token || !passcode) return false;
  const [ts, sig] = token.split(".");
  const issuedAt = Number(ts);
  if (!Number.isFinite(issuedAt) || !sig) return false;
  if (Date.now() - issuedAt > SESSION_MAX_AGE * 1000 || issuedAt > Date.now() + 60000) return false;
  const expected = await hmacHex(passcode, `nexora-session-v1:${issuedAt}`);
  return timingSafeEqual(expected, sig);
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
