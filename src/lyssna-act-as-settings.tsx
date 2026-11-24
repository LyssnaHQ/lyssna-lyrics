import { useEffect, useRef, useState } from "react";
import { actAsChanged, clearActAs, readActAs, setActAs, type ActAs } from "./lyssna-act-as";
import { lyssnaAccountRequest } from "./lyssna-account";
import { SettingRow } from "./lyssna/setting-row";

type Match = { id: string; username: string };

const clock = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });

/** Finds reserved accounts by name (any part of it) or by user ID. */
async function findReserved(query: string): Promise<Match[]> {
  const response = await lyssnaAccountRequest(`/v1/users/reserved?limit=8&q=${encodeURIComponent(query.trim())}`);
  if (!response?.ok) throw new Error(response?.status === 403 ? "Only admins can upload as another account." : "Couldn’t search Lyssna. Try again.");
  const list: unknown = await response.json().catch(() => null);
  if (!Array.isArray(list)) return [];
  return list.filter((item): item is Match => typeof item?.id === "string" && typeof item?.username === "string");
}

/**
 * Admins only: choose a reserved account, and uploads go to it until it is cleared or four hours pass. It is not
 * shown to anyone else, and the API refuses the request unless the account is an admin's to act as.
 */
export function ActAsSettings() {
  const [active, setActive] = useState<ActAs | undefined>(readActAs);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Match[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const latest = useRef(0);

  useEffect(() => {
    const update = () => setActive(readActAs());
    window.addEventListener(actAsChanged, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(actAsChanged, update);
      window.removeEventListener("storage", update);
    };
  }, []);

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
          setError(found.length ? "" : "No reserved account matches.");
        },
        (why) => { if (mine === latest.current) setError(why instanceof Error ? why.message : "Couldn’t search Lyssna."); },
      ).finally(() => { if (mine === latest.current) setBusy(false); });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  return <SettingRow label={active ? `Uploading as ${active.username}` : "Upload as another account"} stacked
    help={active ? `Uploads from this window go to ${active.username} until ${clock.format(active.until)}.`
      : "Admins only. Type part of a reserved account’s name, or paste its user ID, to upload as it for a while."}
    keywords="admin upload as reserved account act as impersonate user uuid">
    {active ? <div className="settings-actions">
      <button type="button" className="pill outline" onClick={clearActAs}>Stop uploading as {active.username}</button>
    </div> : <div className="lyssna-account-form">
      <input type="text" aria-label="Reserved account name or user ID" placeholder="Name or user ID" autoComplete="off"
        spellCheck={false} maxLength={80} value={query} onChange={(event) => setQuery(event.target.value)} />
      {matches.map((match) => <button key={match.id} type="button" className="pill outline" disabled={busy}
        onClick={() => { setActAs(match); setQuery(""); setMatches([]); }}>{match.username}</button>)}
    </div>}
    {error && !active && <p className="settings-alert" role="alert">{error}</p>}
  </SettingRow>;
}
