import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { MicVocal, TriangleAlert, X } from "lucide-react";
import type { Host, Root } from "./host";
import type { BuildOptions } from "./settings-panel";
import noticeCss from "./release-notices.css?inline";

const discord = "https://discord.gg/qfYAsFQawp";
const guide = "https://lyssna.org/guides";
const lastBuildKey = "lyssna-lyrics.v1.last-public-build";
const checkInterval = 120_000;
const ease = "cubic-bezier(0.23, 1, 0.32, 1)";
const openExternal = (url: string) => window.open(url, "_blank", "noopener,noreferrer");

function compareVersions(a: string, b: string) {
  const [aCore, ...aSuffix] = a.split("-");
  const [bCore, ...bSuffix] = b.split("-");
  const before = aCore.split(".").map(Number);
  const after = bCore.split(".").map(Number);
  for (let index = 0; index < 3; index++) {
    if (before[index] !== after[index]) return before[index] - after[index];
  }
  if (!aSuffix.length || !bSuffix.length) return bSuffix.length - aSuffix.length;
  return aSuffix.join("-").localeCompare(bSuffix.join("-"), "en", { numeric: true });
}

// Port of the Legacy patch notes parser by iPixelGalaxy.
function getPatchNotes(markdown: string, from: string, to: string) {
  const notes: { version: string; text: string }[] = [];
  let version = "";
  let current: string[] = [];
  const finishNote = () => {
    if (current.length && version && compareVersions(version, from) > 0 && compareVersions(version, to) <= 0) {
      notes.push({ version, text: current.join(" ") });
    }
    current = [];
  };
  for (const line of markdown.replace(/\r/g, "").split("\n")) {
    const heading = /^##\s+v?(\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?)\s*$/i.exec(line);
    const bullet = /^\s*[-*]\s+(.+)$/.exec(line);
    if (heading) { finishNote(); version = heading[1]; }
    else if (bullet) { finishNote(); current = [bullet[1].trim()]; }
    else if (current.length && line.trim() && !line.startsWith("#")) current.push(line.trim());
  }
  finishNote();
  return notes.sort((a, b) => compareVersions(b.version, a.version));
}

function inlineMarkdown(text: string) {
  const tokens: ReactNode[] = [];
  const pattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index;
    if (index > cursor) tokens.push(text.slice(cursor, index));
    if (match[2]) tokens.push(<a key={index} href={match[2]} target="_blank" rel="noopener noreferrer">{match[1]}</a>);
    else if (match[3]) tokens.push(<strong key={index}>{match[3]}</strong>);
    else tokens.push(<code key={index}>{match[4]}</code>);
    cursor = index + match[0].length;
  }
  if (cursor < text.length) tokens.push(text.slice(cursor));
  return tokens;
}

function PatchNotes({ url, from, to }: { url: string; from: string; to: string }) {
  const [notes, setNotes] = useState<ReturnType<typeof getPatchNotes>>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch(url, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) })
      .then((response) => {
        if (!response.ok) throw new Error("Couldn’t load patch notes.");
        return response.text();
      })
      .then((markdown) => {
        if (!controller.signal.aborted) setNotes(getPatchNotes(markdown, from, to));
      })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [url, from, to, attempt]);
  return <section className="release-notes" aria-label="Patch notes" aria-live="polite">
    <h3>What changed</h3>
    {failed ? <p>Couldn’t load patch notes. <button type="button" className="release-text-button" onClick={() => {
      setFailed(false);
      setAttempt((value) => value + 1);
    }}>Retry</button></p>
      : !notes ? <p>Loading patch notes…</p>
      : notes.length ? <ul>{notes.map(({ version, text }, index) =>
        <li key={`${version}-${index}`}>{inlineMarkdown(text)}</li>)}</ul>
      : <p>No patch notes are available for this update.</p>}
  </section>;
}

type Action = { label: string; run(): void };
type DialogOptions = {
  title: string;
  content: ReactNode[];
  primary: Action;
  secondary: string;
  walkthrough?: boolean;
  origin?: DOMRect;
  dismiss?(): void;
};

function ReleaseDialog({ title, content, primary, secondary, walkthrough, origin, dismiss, close }: DialogOptions & { close(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const primaryButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const startedOutside = useRef(false);
  const closing = useRef<ReturnType<typeof setTimeout>>(undefined);
  const morph = useRef<Animation>(undefined);
  useLayoutEffect(() => {
    const element = dialog.current!;
    element.showModal();
    primaryButton.current?.focus({ preventScroll: true });
    if (origin && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const bounds = element.getBoundingClientRect();
      const x = origin.left + origin.width / 2 - bounds.left - bounds.width / 2;
      const y = origin.top + origin.height / 2 - bounds.top - bounds.height / 2;
      morph.current = element.animate([
        { transform: `translate(${x}px, ${y}px) scale(${origin.width / bounds.width})`, opacity: 0 },
        { opacity: 1, offset: 0.35 },
        { transform: "none", opacity: 1 },
      ], { duration: 420, easing: ease });
    }
    return () => {
      clearTimeout(closing.current);
      morph.current?.cancel();
      element.close();
    };
  }, [origin]);

  function leave(action?: () => void) {
    if (closing.current !== undefined) return;
    morph.current?.cancel();
    dialog.current?.classList.add("release-closing");
    closing.current = setTimeout(() => {
      close();
      action?.();
    }, 200);
  }
  function outside(event: React.PointerEvent<HTMLDialogElement> | React.MouseEvent<HTMLDialogElement>) {
    if (event.target !== event.currentTarget) return false;
    const box = event.currentTarget.getBoundingClientRect();
    return event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
  }
  const stagger = (index: number) => ({ "--release-step": index }) as CSSProperties;
  return <dialog ref={dialog} className="release-dialog" aria-labelledby={titleId}
    onKeyDown={(event) => event.stopPropagation()}
    onCancel={(event) => { event.preventDefault(); leave(dismiss); }}
    onPointerDown={(event) => { startedOutside.current = outside(event); }}
    onClick={(event) => { if (startedOutside.current && outside(event)) leave(dismiss); }}>
    <header style={stagger(0)}>
      <p className="release-brand"><MicVocal size={16} aria-hidden="true" />Lyssna Lyrics</p>
      <h2 id={titleId}>{title}</h2>
    </header>
    {content.map((node, index) => <div className="release-content" key={index} style={stagger(index + 1)}>{node}</div>)}
    <footer className="release-actions" style={stagger(content.length + 1)}>
      <button type="button" className="release-discord" onClick={() => openExternal(discord)}><span>Join our Discord</span></button>
      {walkthrough && <button type="button" className="release-secondary" onClick={() => openExternal(guide)}>New to Lyssna Lyrics?</button>}
      <div className="release-actions-main">
        <button type="button" className="release-quiet" onClick={() => leave(dismiss)}>{secondary}</button>
        <button ref={primaryButton} type="button" className="release-primary" onClick={() => leave(primary.run)}>{primary.label}</button>
      </div>
    </footer>
  </dialog>;
}

function ReleaseToast({ title, description, action, dismiss, warning }: {
  title: string; description: string; action: { label: string; run(origin?: DOMRect): void }; dismiss(): void; warning?: boolean;
}) {
  const toast = useRef<HTMLElement>(null);
  return <aside className="release-toast" ref={toast} aria-label="Lyssna Lyrics update">
    {warning && <TriangleAlert size={18} aria-hidden="true" />}
    <div className="release-toast-copy" role="status"><strong>{title}</strong><p>{description}</p></div>
    <button type="button" className="release-primary" onClick={() => action.run(toast.current?.getBoundingClientRect())}>{action.label}</button>
    <button type="button" className="release-toast-dismiss" aria-label="Dismiss update" onClick={dismiss}><X size={14} /></button>
  </aside>;
}

export function startReleaseNotices(host: Host, options: BuildOptions) {
  const installed = options.hiddenVersion ?? options.channels[options.channel];
  if (!installed) return () => {};
  const version = installed;
  const patchNotes = options.patchNotesUrl;
  const controller = new AbortController();
  const previewWindow = window as Window & { LyssnaLyricsRewrite?: object };
  const mount = document.createElement("div");
  mount.className = "lyssna-rewrite-release-notices";
  const shadow = mount.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = noticeCss;
  const container = document.createElement("div");
  shadow.append(style, container);
  let root: Root | undefined;
  let noticeId = 0;
  let noticeOpen = false;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  let checkTimer: ReturnType<typeof setTimeout> | undefined;
  let loadingTimer: ReturnType<typeof setTimeout> | undefined;
  let stopLoading: (() => void) | undefined;

  function render(node: ReactNode) {
    if (controller.signal.aborted) return;
    clearTimeout(toastTimer);
    if (!root) {
      document.body.append(mount);
      root = host.mount(container);
    }
    noticeOpen = node !== null;
    root.render(node);
  }
  const close = () => render(null);
  const show = (dialog: DialogOptions) => render(<ReleaseDialog key={++noticeId} {...dialog} close={close} />);
  const showFirstLoad = () => show({
    title: "Welcome to Lyssna Lyrics",
    content: [
      <p>Open lyrics with the Lyssna microphone in Spotify’s playbar.</p>,
      <p className="release-small">Use the gear in the lyrics view to change how lyrics look and which sources Lyssna uses.</p>,
    ],
    walkthrough: true,
    primary: { label: "Get started", run() {} },
    secondary: "Close",
  });

  function showUpdatedDialog(from: string, to: string) {
    const upgraded = from !== "0.0.0" && to !== "0.0.0" && compareVersions(to, from) > 0;
    show({
      title: `${upgraded ? "Updated" : "Changed"} to ${to}`,
      content: [
        <p>You were on <strong>{from}</strong>. You are now on <strong>{to}</strong>.</p>,
        ...(upgraded && patchNotes ? [<PatchNotes url={patchNotes} from={from} to={to} />] : []),
        <p className="release-small">Join the <a href={discord} target="_blank" rel="noopener noreferrer">Lyssna Discord server</a> for updates and support.</p>,
      ],
      primary: patchNotes ? { label: "See all patch notes", run: () => openExternal(patchNotes) } : { label: "Got it", run() {} },
      secondary: "Close",
    });
  }

  function presentUpdate(to: string, apply: () => void) {
    const warn = () => {
      render(<ReleaseToast key={++noticeId} title={`Staying on ${version}`} warning
        description="Some lyrics sources and features need the latest version. Updating reloads Spotify."
        action={{ label: "Update", run: () => { close(); apply(); } }} dismiss={close} />);
      toastTimer = setTimeout(close, 9000);
    };
    render(<ReleaseToast key={++noticeId} title={`Lyssna Lyrics ${to} is out`}
      description={`You’re on ${version}.`} dismiss={warn}
      action={{ label: "Details", run: (origin) => show({
        title: `Version ${to} is out`,
        content: [
          <p>You’re on <strong>{version}</strong>. Updating reloads Spotify, which takes a few seconds.</p>,
          <p className="release-small">Join the Lyssna Discord server for updates and support.</p>,
          ...(patchNotes ? [<p className="release-small">See what changed in the <a href={patchNotes} target="_blank" rel="noopener noreferrer">patch notes</a>.</p>] : []),
        ],
        primary: { label: "Update and reload", run: apply },
        secondary: "Not now",
        dismiss: warn,
        origin,
      }) }} />);
  }

  const demoVersion = version.split("-")[0].split(".").map((part, index) => index === 2 ? Number(part) + 1 : part).join(".");
  const previews = {
    showStartup() {
      clearTimeout(loadingTimer);
      stopLoading?.();
      stopLoading = options.showLoading?.();
      loadingTimer = setTimeout(() => { stopLoading?.(); stopLoading = undefined; }, 4000);
    },
    showFirstLoad,
    showUpdateAvailable(to = demoVersion) {
      presentUpdate(to, () => showUpdatedDialog(version, to));
    },
    showUpdatedDialog(from = version, to = demoVersion) { showUpdatedDialog(from, to); },
  };
  previewWindow.LyssnaLyricsRewrite = previews;

  if (!options.hiddenVersion) {
    try {
      const previous = localStorage.getItem(lastBuildKey);
      if (previous !== version) {
        localStorage.setItem(lastBuildKey, version);
        if (previous && /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(previous)) showUpdatedDialog(previous, version);
        else if (!previous) showFirstLoad();
      }
    } catch { /* Version history is optional when settings storage is unavailable. */ }

    let announced: string | null = null;
    const latestVersion = options.latestVersion;
    if (latestVersion) {
      const check = async () => {
        try {
          const latest = await latestVersion(controller.signal);
          if (latest && latest !== announced && !noticeOpen && !controller.signal.aborted && compareVersions(latest, version) > 0) {
            presentUpdate(latest, () => window.location.reload());
            announced = latest;
          }
        } catch { /* Keep the current build after an update check fails. */ }
        finally { if (!controller.signal.aborted) checkTimer = setTimeout(check, checkInterval); }
      };
      checkTimer = setTimeout(check, noticeOpen ? checkInterval : 1000);
    }
  }

  return () => {
    controller.abort();
    clearTimeout(checkTimer);
    clearTimeout(toastTimer);
    clearTimeout(loadingTimer);
    stopLoading?.();
    if (previewWindow.LyssnaLyricsRewrite === previews) delete previewWindow.LyssnaLyricsRewrite;
    root?.unmount();
    mount.remove();
  };
}
