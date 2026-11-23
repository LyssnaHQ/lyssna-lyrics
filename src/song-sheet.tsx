import { useLayoutEffect, useRef, useState } from "react";
import { ExternalLink, X } from "lucide-react";
import { getHost } from "./host";

const site = "https://lyssna.org";
const songIdPattern = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const trackIdPattern = /^[A-Za-z0-9]{22}$/;
const sheetPath = /^\/(?:song|u)\/[^/?#\\]+\/?$/;

export function lyssnaSongUrl(songId: string) {
  return songIdPattern.test(songId) ? `${site}/song/${songId}` : undefined;
}

export function SongSheet({ url, onClose }: { url: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const actions = useRef<HTMLDivElement>(null);
  const [address, setAddress] = useState(() => `${url}?embed&client=spicetify&navigation=sheet&opened=${Date.now()}`);
  const visited = useRef([address]);
  const [page, setPage] = useState(url);
  const [status, setStatus] = useState("Loading song page…");

  useLayoutEffect(() => {
    const element = dialog.current!;
    const buttons = actions.current!;
    const view = element.ownerDocument.defaultView!;
    const timer = view.setTimeout(() => setStatus("The song page couldn’t load here. You can open it in your browser."), 8_000);
    const syncActions = () => {
      const iframe = frame.current;
      if (!iframe?.contentWindow) return;
      const right = Math.ceil(iframe.getBoundingClientRect().right - buttons.getBoundingClientRect().left);
      iframe.contentWindow.postMessage({ type: "lyssna:sheet-actions", right }, site);
    };
    const receive = (event: MessageEvent) => {
      if (event.origin !== site || event.source !== frame.current?.contentWindow) return;
      if (event.data?.type === "lyssna:sheet-close") onClose();
      if (event.data?.type === "lyssna:sheet-ready" && typeof event.data.path === "string" &&
          sheetPath.test(event.data.path)) {
        view.clearTimeout(timer);
        setStatus("");
        setPage(site + event.data.path);
        syncActions();
      }
      if (event.data?.type === "lyssna:sheet-navigate" && typeof event.data.href === "string") {
        let target: URL;
        try { target = new URL(event.data.href, site); }
        catch { return; }
        if (target.origin !== site || target.username || target.password || !sheetPath.test(target.pathname)) return;
        target.searchParams.set("embed", "");
        target.searchParams.set("client", "spicetify");
        target.searchParams.set("navigation", "sheet");
        target.searchParams.delete("opened");
        if (visited.current.at(-1) === target.href) return;
        visited.current.push(target.href);
        setAddress(target.href);
      }
      if (event.data?.type === "lyssna:sheet-back" && visited.current.length > 1) {
        visited.current.pop();
        setAddress(visited.current.at(-1)!);
      }
      if (event.data?.type === "lyssna:sheet-play" && typeof event.data.id === "string" &&
          trackIdPattern.test(event.data.id)) {
        const host = getHost();
        void host.playTrack(`spotify:track:${event.data.id}`).then(onClose).catch(() => {
          view.open(`https://open.spotify.com/track/${event.data.id}`, "_blank", "noopener,noreferrer");
        });
      }
    };
    view.addEventListener("message", receive);
    element.showModal();
    const observer = new ResizeObserver(syncActions);
    observer.observe(element);
    observer.observe(buttons);
    return () => {
      observer.disconnect();
      view.removeEventListener("message", receive);
      view.clearTimeout(timer);
      element.close();
    };
  }, [onClose]);

  return <dialog ref={dialog} className="lyssna-song-sheet" aria-label="Lyssna song page"
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="lyssna-song-sheet-content">
      <div className="lyssna-song-sheet-actions" ref={actions}>
        <a href={page} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} /> Open in browser</a>
        <button type="button" onClick={onClose} aria-label="Close Lyssna song page"><X size={18} /></button>
      </div>
      {status && <p role="status">{status}</p>}
      <iframe key={address} ref={frame} src={address} title="Lyssna song page"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox" />
    </div>
  </dialog>;
}
