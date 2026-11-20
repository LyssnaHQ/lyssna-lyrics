import { useEffect, useState } from "react";
import { accountChanged, beginLyssnaSignIn, finishLyssnaSignIn, hasLyssnaSession, lyssnaProfileName, lyssnaSignOut, type SignIn } from "./lyssna-account";
import { SettingRow } from "./lyssna/setting-row";

export function AccountSettings({ ready }: { ready: boolean }) {
  const [signedIn, setSignedIn] = useState(hasLyssnaSession);
  const [name, setName] = useState<string>();
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
    setName(undefined);
    if (!signedIn) return;
    let live = true;
    void lyssnaProfileName().then((profile) => { if (live) setName(profile); }).catch(() => {});
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

  const help = signedIn ? (name ? `Signed in as ${name}` : "Signed in to Lyssna.")
    : pending ? "Open Lyssna in your browser, then paste the sign-in result here."
    : ready ? "Connect your Lyssna account to Spotify." : "Sign-in is awaiting setup on Lyssna.org.";
  return <SettingRow label="Lyssna account" help={help} keywords="profile login sign in sign out" stacked={!!pending}>
    {signedIn ? <button type="button" className="pill outline" disabled={busy}
      onClick={() => void run(lyssnaSignOut)}>Sign out</button>
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
