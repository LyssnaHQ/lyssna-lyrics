import { useEffect, useState } from "react";
import { ExternalLink, LogOut } from "lucide-react";
import { accountChanged, beginLyssnaSignIn, finishLyssnaSignIn, hasLyssnaSession, lyssnaSignOut, readLyssnaProfile, type LyssnaProfile, type SignIn } from "./lyssna-account";
import { SettingRow } from "./lyssna/setting-row";

export function AccountSettings({ ready }: { ready: boolean }) {
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
    : pending ? "Open Lyssna in your browser, then paste the sign-in result here."
    : ready ? "Connect your Lyssna account to Spotify." : "Sign-in is awaiting setup on Lyssna.org.";
  return <SettingRow label={account?.username ?? "Lyssna account"} help={help}
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
  </SettingRow>;
}
