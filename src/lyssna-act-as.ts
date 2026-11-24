/**
 * Admins can upload as another Lyssna account, a reserved one (made for someone who has not signed up yet) or any
 * other. The choice is kept for a few hours, never longer, and is dropped on sign-out; the API only honours it
 * for admins.
 */
const key = "lyssna-lyrics.api.act-as";
export const actAsChanged = "lyssna-lyrics:act-as";
const lifetime = 4 * 60 * 60 * 1000;

export type ActAs = { id: string; username: string; until: number };

let memory: ActAs | undefined;

export function readActAs(): ActAs | undefined {
  let stored: unknown = memory;
  try {
    stored = JSON.parse(localStorage.getItem(key) ?? "null") ?? memory;
  } catch { /* Memory only. */ }
  const item = stored as Partial<ActAs> | null | undefined;
  if (!item || typeof item.id !== "string" || typeof item.username !== "string" || typeof item.until !== "number") return;
  if (item.until <= Date.now() || !/^[0-9a-f-]{36}$/i.test(item.id)) {
    clearActAs();
    return;
  }
  return { id: item.id, username: item.username, until: item.until };
}

export function setActAs(user: { id: string; username: string }) {
  memory = { id: user.id, username: user.username, until: Date.now() + lifetime };
  try { localStorage.setItem(key, JSON.stringify(memory)); } catch { /* Memory only. */ }
  window.dispatchEvent(new Event(actAsChanged));
}

export function clearActAs() {
  const had = memory !== undefined || (() => { try { return localStorage.getItem(key) !== null; } catch { return false; } })();
  memory = undefined;
  try { localStorage.removeItem(key); } catch { /* Nothing stored. */ }
  if (had) window.dispatchEvent(new Event(actAsChanged));
}

/** Adds the chosen account to an upload path; any other path is left alone. */
export function withActAs(path: string) {
  const chosen = readActAs();
  return chosen ? `${path}${path.includes("?") ? "&" : "?"}as=${chosen.id}` : path;
}
