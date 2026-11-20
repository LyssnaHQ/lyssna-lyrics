const key = "lyssna-lyrics.v1.view-session";
const previousKey = "lyssna-lyrics.v1.active-view";

export type ViewSession = { route?: string; lyrics: boolean };

export function readViewSession(): ViewSession | undefined {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? "null");
    if (typeof saved?.lyrics === "boolean") {
      const route = typeof saved.route === "string" && /^\/(?!\/)[^\\\x00-\x1f]*$/.test(saved.route)
        ? saved.route
        : undefined;
      return { route, lyrics: saved.lyrics };
    }
    if (sessionStorage.getItem(previousKey) === "open") return { lyrics: true };
  } catch (error) {
    console.warn("[Lyssna Lyrics] Could not read the last view", error);
  }
}

export function saveViewSession(session: ViewSession) {
  try {
    localStorage.setItem(key, JSON.stringify(session));
    sessionStorage.removeItem(previousKey);
  } catch (error) {
    console.warn("[Lyssna Lyrics] Could not save the current view", error);
  }
}
