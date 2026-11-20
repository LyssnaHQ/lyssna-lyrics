const origin = "https://api.lyssna.org";
const projectKey = "lk_pub_0eaYf5RZnJ-pj2NfP2k2QWVlOZDFTdPK";
const installKey = "lyssna-lyrics.api.install";
const retryKey = "lyssna-lyrics.api.install-retry";
const clientKey = "lyssna-lyrics.api.play-client";
export const lyssnaInstallReady = "lyssna-lyrics:api-install-ready";
export const lyssnaApiNotice = "lyssna-lyrics:api-notice";

let install: string | undefined;
let registering: Promise<string | undefined> | undefined;
let registerAfter = 0;
let retryAfter = 0;
let delay = 30_000;
let blocked = false;

function saved(key: string) {
  try { return localStorage.getItem(key) ?? undefined; }
  catch { return undefined; }
}

function save(key: string, value: string) {
  try { localStorage.setItem(key, value); }
  catch { /* Keep using the in-memory install if storage is unavailable. */ }
}

type RequestOptions = { body?: object; etag?: string; accessToken?: string; waitForInstall?: boolean };

async function send(path: string, { body, etag, installation, accessToken }: RequestOptions & {
  installation?: string;
}) {
  const url = new URL(path, origin);
  if (url.origin !== origin) throw new Error("Invalid Lyssna API address.");
  const headers = new Headers({ "Lyssna-Key": projectKey });
  if (installation) headers.set("Lyssna-Install", installation);
  if (etag) headers.set("If-None-Match", etag);
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  if (body) headers.set("Content-Type", "application/json");
  const response = await fetch(url, {
    headers, method: body ? "POST" : "GET", body: body ? JSON.stringify(body) : undefined,
    credentials: "omit", redirect: "error", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(8_000),
  });
  if (response.status === 429 || (response.status === 503 && response.headers.has("Retry-After"))) {
    const header = response.headers.get("Retry-After");
    const wait = header && /^\d+$/.test(header) ? Number(header) * 1_000 : Date.parse(header ?? "") - Date.now();
    retryAfter = Math.max(retryAfter, Date.now() + Math.max(Number.isFinite(wait) ? wait : 0, delay));
    delay = Math.min(delay * 2, 15 * 60_000);
  } else if (response.ok || response.status === 304 || response.status === 404) {
    if (Date.now() >= retryAfter) delay = 30_000;
  }
  if (response.status === 401 || response.status === 403) {
    const { error, message } = await response.clone().json().catch(() => ({}));
    if (error === "invalid_key" || error === "blocked" || error === "app_suspended") {
      if (!blocked) {
        blocked = true;
        const notice = error === "invalid_key" ? "The Lyssna Lyrics API key was rejected. Contact Lyssna support."
          : typeof message === "string" && message.trim() && message.length <= 200 ? message
          : "The Lyssna Lyrics API has blocked access for this installation.";
        window.dispatchEvent(new CustomEvent(lyssnaApiNotice, { detail: notice }));
      }
    }
    return { response, error };
  }
  return { response };
}

async function solve(challenge: string, difficulty: number, expires: number) {
  const encoder = new TextEncoder();
  for (let counter = 0; Date.now() < expires; counter += 64) {
    const hashes = await Promise.all(Array.from({ length: 64 }, (_, i) =>
      crypto.subtle.digest("SHA-256", encoder.encode(`${challenge}:${counter + i}`))));
    const found = hashes.findIndex((hash) => {
      let remaining = difficulty;
      for (const byte of new Uint8Array(hash)) {
        if (remaining <= Math.clz32(byte) - 24) return true;
        if (byte !== 0) return false;
        remaining -= 8;
      }
      return false;
    });
    if (found >= 0) return String(counter + found);
  }
}

function register(rejected?: string) {
  if (registering) return registering;
  async function work() {
    const stored = saved(installKey) || undefined;
    if (stored && stored !== rejected) return install = stored;
    if (blocked || Date.now() < Math.max(retryAfter, registerAfter, Number(saved(retryKey)) || 0)) return;
    registerAfter = Date.now() + 30_000;
    save(retryKey, String(registerAfter));
    try {
      const challengeResponse = await send("/v1/installs/challenge", { body: {} });
      if (!challengeResponse.response.ok) return;
      const { challenge, difficulty, expires_at } = await challengeResponse.response.json();
      const expires = Date.parse(expires_at);
      if (typeof challenge !== "string" || !Number.isInteger(difficulty) || difficulty < 0 || difficulty > 28 ||
        !Number.isFinite(expires) || expires <= Date.now()) return;
      const counter = await solve(challenge, difficulty, expires);
      if (counter === undefined || blocked || Date.now() < retryAfter) return;
      const result = await send("/v1/installs", { body: { challenge, counter } });
      if (!result.response.ok) return;
      const { install: registered } = await result.response.json();
      if (typeof registered !== "string" || !registered) return;
      install = registered;
      save(installKey, registered);
      save(retryKey, "0");
      registerAfter = 0;
      window.dispatchEvent(new Event(lyssnaInstallReady));
      return install;
    } catch {
      return undefined;
    } finally {
      if (!install) {
        registerAfter = Math.max(Date.now() + 30_000, retryAfter);
        save(retryKey, String(registerAfter));
      }
    }
  }
  registering = (navigator.locks ? navigator.locks.request(installKey, work) : work())
    .catch(() => undefined).finally(() => { registering = undefined; });
  return registering;
}

export function prepareLyssnaInstall() {
  if (!install && !saved(installKey)) void register();
}

export async function lyssnaRequest(path: string, options: RequestOptions = {}) {
  if (blocked || Date.now() < retryAfter || !navigator.onLine) return;
  const installation = (install ??= saved(installKey) || undefined) ?? (options.waitForInstall ? await register() : undefined);
  if (!installation) { if (!options.body) void register(); return; }
  if (blocked || Date.now() < retryAfter) return;
  const first = await send(path, { ...options, installation });
  if (first.error !== "install_required") return first.response;
  if (install === installation) {
    install = undefined;
    if (saved(installKey) === installation) save(installKey, "");
  }
  if (options.body && !options.waitForInstall) { void register(installation); return first.response; }
  const replacement = await register(installation);
  if (replacement && !blocked && Date.now() >= retryAfter) {
    const retried = await send(path, { ...options, installation: replacement });
    if (retried.error === "install_required") {
      blocked = true;
      save(retryKey, String(Date.now() + 30_000));
      if (install === replacement) install = undefined;
      if (saved(installKey) === replacement) save(installKey, "");
      window.dispatchEvent(new CustomEvent(lyssnaApiNotice, {
        detail: "The Lyssna Lyrics API rejected the replacement install. Contact Lyssna support.",
      }));
    }
    return retried.response;
  }
}

export const lyssnaRetryAt = () => retryAfter;

let playClient: string | undefined;
export function sendLyssnaPlay(songId: string, accessToken?: string) {
  if (!install && !saved(installKey)) return;
  if (!playClient) {
    playClient = saved(clientKey) || crypto.randomUUID();
    save(clientKey, playClient);
  }
  void lyssnaRequest(`/v1/songs/${songId}/play`, { body: { client_id: playClient }, accessToken }).catch(() => {});
}
