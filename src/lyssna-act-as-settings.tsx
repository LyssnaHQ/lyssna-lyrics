import { useEffect, useRef, useState } from "react";
import { actAsChanged, clearActAs, readActAs, setActAs, type ActAs } from "./lyssna-act-as";
import { lyssnaAccountRequest } from "./lyssna-account";
import { SettingRow } from "./lyssna/setting-row";

type Match = { id: string; username: string };

const userId = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

async function findAccounts(query: string): Promise<Match[]> {
  const byId = userId.test(query);
  const path = byId ? `/v1/users/${query}` : `/v1/search/users?limit=8&q=${encodeURIComponent(query)}`;
  const response = await lyssnaAccountRequest(path);
  if (response?.status === 404 && byId) return [];
  if (!response?.ok) throw new Error("Couldn’t search Lyssna. Try again.");
  const data: unknown = await response.json();
  const matches = byId ? [data] : Array.isArray(data) ? data : [];
  return matches.filter((item): item is Match => typeof item?.id === "string" && userId.test(item.id) && typeof item?.username === "string");
}

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
    const mine = ++latest.current;
    setMatches([]);
    setError("");
    setBusy(false);
    if (Array.from(text).length < 2) return;
    const timer = window.setTimeout(() => {
      setBusy(true);
      findAccounts(text).then(
        (found) => {
          if (mine !== latest.current) return;
          setMatches(found);
          setError(found.length ? "" : "No matching accounts.");
        },
        (why) => { if (mine === latest.current) setError(why instanceof Error ? why.message : "Couldn’t search Lyssna."); },
      ).finally(() => { if (mine === latest.current) setBusy(false); });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      latest.current++;
    };
  }, [query]);

  return <SettingRow label={active ? `Uploading as ${active.username}` : "Upload as another account"} stacked
    keywords="admin upload as account act as user uuid">
    {active ? <div className="settings-actions">
      <button type="button" className="pill outline" onClick={clearActAs}>Stop uploading as {active.username}</button>
    </div> : <div className="lyssna-account-form">
      <input type="text" aria-label="Account name or user ID" placeholder="Name or user ID" autoComplete="off"
        spellCheck={false} maxLength={80} value={query} onChange={(event) => setQuery(event.target.value)} />
      {matches.map((match) => <button key={match.id} type="button" className="pill outline" disabled={busy}
        onClick={() => { setActAs(match); setQuery(""); setMatches([]); }}>{match.username}</button>)}
    </div>}
    {error && !active && <p className="settings-alert" role="alert">{error}</p>}
  </SettingRow>;
}
