import { useEffect, useRef, useState } from "react";
import { clearActAs, readActAs, setActAs, subscribeActAs, type ActAs } from "./lyssna-act-as";
import { lyssnaAccountRequest } from "./lyssna-account";
import { SettingRow } from "./lyssna/setting-row";

type Match = { id: string; username: string };

const clock = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });

/** Finds accounts by name (any part of it) or by user ID; reserved accounts come first. */
async function findReserved(query: string): Promise<Match[]> {
  const response = await lyssnaAccountRequest(`/v1/users/act-as?limit=8&q=${encodeURIComponent(query.trim())}`);
  if (!response?.ok) throw new Error(response?.status === 403 ? "Only admins can upload as another account." : "Couldn’t search Lyssna. Try again.");
  const list: unknown = await response.json().catch(() => null);
  if (!Array.isArray(list)) return [];
  return list.filter((item): item is Match => typeof item?.id === "string" && typeof item?.username === "string");
}

/**
 * Admins only: choose an account, and uploads go to it until it is cleared or four hours pass. It is not
 * shown to anyone else, and the API refuses the request unless the account is an admin's to act as.
 */
export function ActAsSettings() {
  const [active, setActive] = useState<ActAs | undefined>(readActAs);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Match[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const latest = useRef(0);

  useEffect(() => subscribeActAs(() => setActive(readActAs())), []);

  useEffect(() => {
    const text = query.trim();
    if (!text) {
      setMatches([]);
      setError("");
      return;
    }
    const mine = ++latest.current;
    const timer = window.setTimeout(() => {
      setBusy(true);
      findReserved(text).then(
        (found) => {
          if (mine !== latest.current) return;
          setMatches(found);
          setError(found.length ? "" : "No account matches.");
        },
        (why) => { if (mine === latest.current) setError(why instanceof Error ? why.message : "Couldn’t search Lyssna."); },
      ).finally(() => { if (mine === latest.current) setBusy(false); });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  return <SettingRow label={active ? `Uploading as ${active.username}` : "Upload as another account"}
    keywords="admin upload as reserved account act as impersonate user uuid">
    {active ? <button type="button" className="pill outline" onClick={clearActAs}
      title={`Uploads go to ${active.username} until ${clock.format(active.until)}.`}>Stop uploading as {active.username}</button>
    : <div className="lyssna-account-form lyssna-act-as-form">
      <input type="text" aria-label="Account name or user ID" placeholder="Name or user ID" autoComplete="off"
        spellCheck={false} maxLength={80} value={query} onChange={(event) => setQuery(event.target.value)} />
      {matches.length > 0 && <div className="settings-actions">
        {matches.map((match) => <button key={match.id} type="button" className="pill outline" disabled={busy}
          onClick={() => { setActAs(match); setQuery(""); setMatches([]); }}>{match.username}</button>)}
      </div>}
      {error && <p className="settings-alert" role="alert">{error}</p>}
    </div>}
  </SettingRow>;
}
