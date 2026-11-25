import { useEffect, useState } from "react";
import { ExternalLink, LogOut } from "lucide-react";
import { accountChanged, beginLyssnaSignIn, finishLyssnaSignIn, hasLyssnaSession, lyssnaAccountRequest, lyssnaSignOut, readLyssnaProfile, type LyssnaProfile, type SignIn } from "./lyssna-account";
import { ActAsSettings } from "./lyssna-act-as-settings";
import { SettingRow } from "./lyssna/setting-row";
import type { Host } from "./host";

async function accountPages<T>(path: string) {
  const items: T[] = [];
  for (;;) {
    const response = await lyssnaAccountRequest(`${path}?limit=50&offset=${items.length}`);
    if (!response?.ok) throw new Error("Couldn’t load Lyssna catalogue records.");
    const page: unknown = await response.json();
    if (!Array.isArray(page)) throw new Error("Lyssna returned an invalid catalogue page.");
    items.push(...page);
    if (page.length < 50) return items;
  }
}

function IsrcBackfill({ host }: { host: Host }) {
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState("");
  return <SettingRow label="Add ISRC links" help="Find ISRCs for Lyssna songs that only have a Spotify link.">
    <button type="button" className="pill outline" disabled={working} onClick={async () => {
      if (!confirming) { setConfirming(true); return; }
      setConfirming(false);
      setWorking(true);
      let added = 0, conflicts = 0, failed = 0;
      try {
        const users = await accountPages<{ id: string }>("/v1/users");
        const songs = new Set<string>();
        for (const user of users) {
          for (const song of await accountPages<{ song_id: string }>(`/v1/users/${encodeURIComponent(user.id)}/contributions`))
            songs.add(song.song_id);
        }
        let visited = 0;
        for (const id of songs) {
          setStatus(`Checking song ${++visited} of ${songs.size}…`);
          const path = `/v1/songs/${encodeURIComponent(id)}`;
          const response = await lyssnaAccountRequest(path).catch(() => undefined);
          if (!response?.ok) { failed++; continue; }
          const song = await response.json() as { links?: { platform: string; external_id: string }[] };
          if (song.links?.some(link => link.platform === "isrc")) continue;
          const spotify = song.links?.find(link => link.platform === "spotify");
          if (!spotify || !/^[A-Za-z0-9]{22}$/.test(spotify.external_id)) continue;
          const isrc = await host.lookupIsrc(spotify.external_id).catch(() => undefined);
          if (!isrc) continue;
          const linked = await lyssnaAccountRequest(`${path}/links`, { platform: "isrc", external_id: isrc }).catch(() => undefined);
          if (linked?.ok) added++;
          else if (linked?.status === 409) conflicts++;
          else failed++;
        }
        setStatus(`Added ${added} links across ${songs.size} songs. ${conflicts} conflicts and ${failed} failures.`);
      } catch (error) {
        setStatus(`Added ${added} links. ${error instanceof Error ? error.message : "Backfill stopped."}`);
      } finally { setWorking(false); }
    }}>{working ? "Adding links…" : confirming ? "Confirm catalogue backfill" : "Add ISRC links"}</button>
    {confirming && <button type="button" className="pill outline" onClick={() => setConfirming(false)}>Cancel</button>}
    {status && <small role="status">{status}</small>}
  </SettingRow>;
}

export function AccountSettings({ ready, host }: { ready: boolean; host: Host }) {
  const [signedIn, setSignedIn] = useState(hasLyssnaSession);
  const [profile, setProfile] = useState<LyssnaProfile | null>();
  const [pending, setPending] = useState<SignIn>();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const update = () => setSignedIn(hasLyssnaSession());
    window.addEventListener(accountChanged, update);
    window.addEventListener("storage", update);
    update();
    return () => {
      window.removeEventListener(accountChanged, update);
      window.removeEventListener("storage", update);
    };
  }, []);
  useEffect(() => {
    setProfile(undefined);
    if (!signedIn) return;
    let live = true;
    void readLyssnaProfile().then(
      (account) => { if (live) setProfile(account ?? null); },
      () => { if (live) setProfile(null); },
    );
    return () => { live = false; };
  }, [signedIn]);

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    try { await task(); }
    catch (why) {
      setError(why instanceof Error && why.name === "Error" ? why.message : "Couldn’t contact Lyssna. Try again.");
    } finally { setBusy(false); }
  }

  const account = signedIn ? profile : undefined;
  const role = account?.role;
  const details = account && [
    role && role !== "user" && `${role[0].toUpperCase()}${role.slice(1)}`,
    account.tier,
    account.reputation !== undefined && `${account.reputation} reputation`,
    account.emailVerified === false && "confirm your email on lyssna.org to submit lyrics",
  ].filter(Boolean).join(" · ");
  const help = signedIn ? (account ? details || "Signed in to Lyssna."
    : profile === null ? "Signed in. Couldn’t load account details." : "Checking…")
    : pending ? "Approve on Lyssna, then paste the sign-in result here within one minute."
    : ready ? "Connect your Lyssna account to Spotify." : "Sign-in is awaiting setup on Lyssna.org.";
  return <><SettingRow label={account ? `Lyssna Account · ${account.username}` : "Lyssna account"} help={help}
    keywords="lyssna account profile login sign in sign out reputation tier email" stacked={!!pending}>
    {signedIn ? <div className="settings-actions lyssna-account-actions">
      {account && <a className="pill outline" href={`https://lyssna.org/u/${encodeURIComponent(account.username)}`}
        target="_blank" rel="noopener noreferrer">Profile <ExternalLink size={13} /></a>}
      <button type="button" className="pill outline" disabled={busy}
        onClick={() => void run(lyssnaSignOut)}><LogOut size={14} /> Sign out</button>
    </div>
      : ready && (pending ? <form className="lyssna-account-form" onSubmit={(event) => {
        event.preventDefault();
        if (busy || !code.trim()) return;
        void run(async () => {
          await finishLyssnaSignIn(pending, code);
          setPending(undefined);
          setCode("");
        });
      }}>
        <a className="pill outline" href={pending.url} target="_blank" rel="noopener noreferrer">Open Lyssna sign-in</a>
        <input type="text" aria-label="Lyssna sign-in result" placeholder="Paste sign-in result"
          autoComplete="off" spellCheck={false} maxLength={2048} disabled={busy} value={code}
          onChange={(event) => setCode(event.target.value)} />
        <button type="submit" className="pill outline" disabled={busy || !code.trim()}>Connect</button>
        <button type="button" className="pill outline" disabled={busy} onClick={() => {
          setPending(undefined);
          setCode("");
          setError("");
        }}>Cancel</button>
      </form> : <button type="button" className="pill outline" disabled={busy}
        onClick={() => void run(async () => setPending(await beginLyssnaSignIn()))}>Sign in</button>)}
    {error && <p className="settings-alert" role="alert">{error}</p>}
  </SettingRow>
  {account?.role === "admin" && <><ActAsSettings /><IsrcBackfill host={host} /></>}</>;
}
