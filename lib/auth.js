import { jsonResponse } from "./http.js";

export const SESSION_COOKIE = "hr_session";
const MAX_AGE_SEC = 7 * 24 * 60 * 60;
const DEFAULT_ADMIN_USERNAME = "admin";

function getSecret() {
  return process.env.AUTH_SECRET || getAdminPassword() || "";
}

/** Single admin account — credentials from env only, no user database. */
export function getAdminConfig() {
  const username =
    process.env.ADMIN_USERNAME ||
    process.env.DASHBOARD_USERNAME ||
    DEFAULT_ADMIN_USERNAME;
  const password =
    process.env.ADMIN_PASSWORD ||
    process.env.DASHBOARD_PASSWORD ||
    "";
  if (!password) {
    throw new Error("Missing ADMIN_PASSWORD (set in Vercel environment variables)");
  }
  return { username, password, secret: getSecret() };
}

function getAdminPassword() {
  return process.env.ADMIN_PASSWORD || process.env.DASHBOARD_PASSWORD || "";
}

async function hmacHex(message, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Buffer.from(sig).toString("hex");
}

export async function createSessionToken() {
  const { username, secret } = getAdminConfig();
  if (!secret) throw new Error("Missing AUTH_SECRET or ADMIN_PASSWORD for sessions");
  const exp = Date.now() + MAX_AGE_SEC * 1000;
  const payload = `${username}:${exp}`;
  const signature = await hmacHex(payload, secret);
  return `${Buffer.from(payload).toString("base64url")}.${signature}`;
}

export async function verifySessionToken(token) {
  if (!token) return null;
  const secret = getSecret();
  if (!secret) return null;

  try {
    const [payloadB64, signature] = token.split(".");
    if (!payloadB64 || !signature) return null;

    const payload = Buffer.from(payloadB64, "base64url").toString();
    const expected = await hmacHex(payload, secret);
    if (signature.length !== expected.length) return null;

    let mismatch = 0;
    for (let i = 0; i < signature.length; i++) {
      mismatch |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
    }
    if (mismatch !== 0) return null;

    const [username, expStr] = payload.split(":");
    let adminUser;
    try {
      adminUser = getAdminConfig().username;
    } catch {
      return null;
    }
    if (username !== adminUser || !expStr || Date.now() > Number(expStr)) return null;
    return { username: adminUser };
  } catch {
    return null;
  }
}

/** Verify the single admin password (username is not checked — one admin only). */
export function verifyAdminPassword(password) {
  const { password: expected } = getAdminConfig();
  return password === expected;
}

export function parseCookie(cookieHeader, name = SESSION_COOKIE) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function sessionCookieHeader(token) {
  const secure = process.env.VERCEL ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_SEC}${secure}`;
}

export function clearSessionCookieHeader() {
  const secure = process.env.VERCEL ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export async function requireAuth(req, res) {
  const token = parseCookie(req.headers.cookie);
  const session = await verifySessionToken(token);
  if (!session) {
    jsonResponse(res, 401, { error: "Unauthorized" });
    return null;
  }
  return session;
}
