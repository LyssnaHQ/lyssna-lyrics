import { lyssnaRequest, prepareLyssnaInstall } from "./lyssna-api";

const clientId = "01a1f5b3-37b0-7d27-9434-efb756ccd7dd";
const redirect = "https://lyssna.org/connect/code";
const key = "lyssna-lyrics.api.account";
export const accountChanged = "lyssna-lyrics:account";

type Tokens = { access_token: string; access_expires_at: string; refresh_token: string; refresh_expires_at: string };
export type SignIn = { url: string; verifier: string; state: string };
export type LyssnaProfile = {
  username: string;
  role?: string;
  reputation?: number;
  tier?: string;
  emailVerified?: boolean;
};

let session: Tokens | undefined;
let memoryOnly = false;
let queued: Promise<unknown> = Promise.resolve();

function tokens(value: unknown): value is Tokens {
  const item = value as Partial<Tokens> | null;
  return !!item && typeof item.access_token === "string" && !!item.access_token &&
    typeof item.refresh_token === "string" && !!item.refresh_token &&
    typeof item.access_expires_at === "string" && Number.isFinite(Date.parse(item.access_expires_at)) &&
    typeof item.refresh_expires_at === "string" && Number.isFinite(Date.parse(item.refresh_expires_at));
}

function readTokens() {
  if (memoryOnly) return session;
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    return tokens(stored) ? stored : undefined;
  } catch { return session; }
}

function saveTokens(next?: Tokens) {
  session = next;
  try {
    if (next) localStorage.setItem(key, JSON.stringify(next));
    else localStorage.removeItem(key);
  } catch {
    memoryOnly = true;
    try { localStorage.removeItem(key); } catch { /* Continue using memory. */ }
  }
  window.dispatchEvent(new Event(accountChanged));
}

function serialize<T>(task: () => Promise<T>): Promise<T> {
  if (navigator.locks) return navigator.locks.request(key, task);
  const next = queued.then(task, task);
  queued = next;
  return next;
}

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
const random = () => base64url(crypto.getRandomValues(new Uint8Array(32)));

export async function beginLyssnaSignIn(): Promise<SignIn> {
  prepareLyssnaInstall();
  const verifier = random();
  const state = random();
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  const url = new URL("https://lyssna.org/authorize");
  url.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirect, state,
    code_challenge: challenge, code_challenge_method: "S256", scope: "profile submit vote notifications" }).toString();
  return { url: url.href, verifier, state };
}

export async function finishLyssnaSignIn(pending: SignIn, pasted: string) {
  const query = new URLSearchParams(pasted.trim().replace(/^.*\?/, ""));
  const code = query.get("code");
  if (query.getAll("state").length !== 1 || query.get("state") !== pending.state) {
    throw new Error("This code belongs to a different sign-in. Start again.");
  }
  if (query.has("error")) throw new Error("Sign-in was cancelled on Lyssna.");
  if (!code || query.getAll("code").length !== 1 || !/^[A-Za-z0-9_-]{16,256}$/.test(code)) {
    throw new Error("Paste the full sign-in result from Lyssna.");
  }
  await serialize(async () => {
    const response = await lyssnaRequest("/v1/auth/token", { waitForInstall: true, body: {
      grant_type: "authorization_code", code, code_verifier: pending.verifier, redirect_uri: redirect, client_id: clientId,
    } });
    if (!response || response.status === 429 || response.status >= 500) throw new Error("Lyssna sign-in is temporarily unavailable. Try again later.");
    if (!response.ok) throw new Error("Lyssna couldn’t use this code. Start sign-in again.");
    const next: unknown = await response.json();
    if (!tokens(next)) throw new Error("Lyssna returned an incomplete sign-in.");
    saveTokens(next);
  });
}

export const hasLyssnaSession = () => Boolean(readTokens());

export async function lyssnaAccess(rejected?: string) {
  const current = readTokens();
  if (!current) return;
  const usable = (entry: Tokens) => entry.access_token !== rejected && Date.parse(entry.access_expires_at) > Date.now();
  if (usable(current)) return current.access_token;
  return serialize(async () => {
    const latest = readTokens();
    if (!latest) return;
    if (usable(latest)) return latest.access_token;
    if (Date.parse(latest.refresh_expires_at) <= Date.now()) {
      saveTokens();
      return;
    }
    try {
      const response = await lyssnaRequest("/v1/auth/token", { waitForInstall: true, body: {
        grant_type: "refresh_token", refresh_token: latest.refresh_token, client_id: clientId,
      } });
      if (!response || [403, 429, 503].includes(response.status)) return;
      if (response.ok) {
        const next: unknown = await response.json();
        if (tokens(next)) {
          saveTokens(next);
          return next.access_token;
        }
      }
    } catch { /* The server may have already rotated the refresh token. */ }
    saveTokens();
  });
}

export async function lyssnaAccountRequest(path: string, body?: object, method?: "PUT") {
  let accessToken = await lyssnaAccess();
  if (!accessToken) return;
  const options = { body, method, waitForInstall: !!body };
  const response = await lyssnaRequest(path, { ...options, accessToken });
  if (response?.status !== 401) return response;
  const rejected = await response.clone().json().catch(() => null) as { error?: string } | null;
  if (rejected?.error !== "unauthorized") return response;
  accessToken = await lyssnaAccess(accessToken);
  return accessToken ? lyssnaRequest(path, { ...options, accessToken }) : response;
}

export async function readLyssnaProfile(): Promise<LyssnaProfile | undefined> {
  const response = await lyssnaAccountRequest("/v1/me");
  if (!response?.ok) return;
  const profile = await response.json() as {
    user?: { username?: string; role?: string; reputation?: number; email_verified?: boolean };
    tier?: { name?: string };
  } | null;
  const user = profile?.user;
  if (typeof user?.username !== "string" || !user.username) return;
  return {
    username: user.username,
    role: typeof user.role === "string" && user.role ? user.role : undefined,
    reputation: typeof user.reputation === "number" && Number.isFinite(user.reputation) ? user.reputation : undefined,
    tier: typeof profile?.tier?.name === "string" && profile.tier.name ? profile.tier.name : undefined,
    emailVerified: typeof user.email_verified === "boolean" ? user.email_verified : undefined,
  };
}

export async function lyssnaSignOut() {
  await serialize(async () => {
    const previous = readTokens();
    saveTokens();
    if (previous) await lyssnaRequest("/v1/auth/logout", { body: {}, accessToken: previous.access_token }).catch(() => {});
  });
}
