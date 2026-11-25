import { useEffect, useMemo, useRef, useState } from "react";
import { lyssnaInstallReady, lyssnaRequest, lyssnaRetryAt } from "./lyssna-api";
import { fetchSpotifyMedia } from "./spotify-media";
import { clearStoredMotionArtwork, deleteStoredMotionArtwork, readStoredMotionArtwork, saveMotionArtwork } from "./motion-artwork-storage";
import workerSource from "./motion-artwork-worker.js?raw";

const digits = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const upcs = new Map<string, Promise<string | null | undefined>>();
const covers = new Map<string, { expires: number; value: Promise<string | undefined> }>();
const maxInputBytes = 24 * 1024 * 1024;
const memoryBudget = 64 * 1024 * 1024;
const recentCovers = new Map<string, Blob>();
let cacheRevision = 0;
let clearing: Promise<void> | undefined;
type MotionCover =
  | { state: "idle" }
  | { state: "loading"; progress?: number }
  | { state: "ready"; url: string; progress?: number };
type CoverLoad = {
  result: Promise<Blob | undefined>; cancel(): void; users: number;
  progress?: number; listeners: Set<(progress?: number) => void>;
};
const loads = new Map<string, CoverLoad>();
const noMotion: MotionCover = { state: "idle" };

export function clearMotionArtworkCache() {
  if (clearing) return clearing;
  cacheRevision++;
  upcs.clear();
  covers.clear();
  for (const load of loads.values()) load.cancel();
  loads.clear();
  recentCovers.clear();
  clearing = clearStoredMotionArtwork().finally(() => { clearing = undefined; });
  return clearing;
}

export function removeMotionArtworkCache(key: string) {
  loads.get(key)?.cancel();
  loads.delete(key);
  recentCovers.delete(key);
  return deleteStoredMotionArtwork(key);
}

function rememberCover(key: string, cover: Blob) {
  if (cover.size > memoryBudget) return;
  recentCovers.set(key, cover);
  let bytes = Array.from(recentCovers.values()).reduce((sum, item) => sum + item.size, 0);
  while (bytes > memoryBudget || recentCovers.size > 6) {
    const [oldest, item] = recentCovers.entries().next().value!;
    recentCovers.delete(oldest);
    bytes -= item.size;
  }
}

function motionArtworkFormat(view: Window) {
  const video = view.document.createElement("video");
  if (video.canPlayType('video/mp4; codecs="avc1.64001f"')) return "mp4";
  if (video.canPlayType('video/webm; codecs="vp8"') && typeof Worker === "function" &&
    typeof WebAssembly === "object") return "webm";
}

async function downloadCover(source: string, signal: AbortSignal, update: (progress: number) => void) {
  const response = await fetch(source, { signal, credentials: "omit", redirect: "error", referrerPolicy: "no-referrer" });
  const total = Number(response.headers.get("Content-Length"));
  if (!response.body) return;
  if (response.status !== 200 || total > maxInputBytes) { await response.body.cancel(); return; }
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxInputBytes) { await reader.cancel(); return; }
      chunks.push(value);
      if (total > 0) update(Math.min(99, Math.floor(100 * size / total)));
    }
  } finally { reader.releaseLock(); }
  const blob = new Blob(chunks, { type: "video/mp4" });
  const header = new Uint8Array(await blob.slice(4, 8).arrayBuffer());
  if (String.fromCharCode(...header) === "ftyp") return blob;
}

function convertCover(input: ArrayBuffer, signal: AbortSignal, update: (progress: number) => void) {
  return new Promise<Blob | undefined>((resolve) => {
    if (signal.aborted) { resolve(undefined); return; }
    const script = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
    let worker: Worker;
    try { worker = new Worker(script, { type: "module" }); }
    catch { resolve(undefined); return; }
    finally { URL.revokeObjectURL(script); }

    const cancel = () => finish();
    function finish(blob?: Blob) {
      signal.removeEventListener("abort", cancel);
      worker.terminate();
      resolve(blob);
    }
    signal.addEventListener("abort", cancel, { once: true });
    worker.onmessage = ({ data }: MessageEvent<{ progress: number } | Uint8Array<ArrayBuffer> | null>) => {
      if (data && "progress" in data) {
        update(data.progress);
      } else {
        finish(data?.length ? new Blob([data], { type: "video/webm" }) : undefined);
      }
    };
    worker.onerror = () => finish();
    try { worker.postMessage(input, [input]); }
    catch { finish(); }
  });
}

function startCoverLoad(key: string, source: string, format: "mp4" | "webm") {
  const abort = new AbortController();
  const timeout = window.setTimeout(() => abort.abort(), 60_000);
  function update(progress: number) {
    if (progress === load.progress) return;
    load.progress = progress;
    load.listeners.forEach((listener) => listener(progress));
  }
  const result = downloadCover(source, abort.signal, (progress) => update(format === "mp4" ? progress : Math.floor(progress / 4)))
    .then(async (mp4) => {
      if (!mp4 || format === "mp4") return mp4;
      return convertCover(await mp4.arrayBuffer(), abort.signal, update);
    }).catch(() => undefined).then((blob) => {
      if (loads.get(key) !== load || !blob) return;
      rememberCover(key, blob);
      void saveMotionArtwork(key, blob).catch(() => {});
      return blob;
    }).finally(() => {
      window.clearTimeout(timeout);
      if (loads.get(key) === load) loads.delete(key);
    });
  const load: CoverLoad = { result, cancel: () => abort.abort(), users: 0, listeners: new Set() };
  loads.set(key, load);
  return load;
}

function normalizeUpc(value: unknown) {
  if (typeof value !== "string" || !/^\d{8,14}$/.test(value)) return;
  const upc = value.padStart(14, "0");
  const check = Array.from(upc).reduce((sum, digit, index) => sum + Number(digit) * (index % 2 ? 1 : 3), 0);
  if (check % 10 === 0) return upc;
}

function albumUpc(album: string) {
  const cached = upcs.get(album);
  if (cached) return cached;
  async function lookup() {
    let id = 0n;
    for (const character of album) id = id * 62n + BigInt(digits.indexOf(character));
    if (id >= 1n << 128n) return null;
    const response = await fetchSpotifyMedia(`/metadata/4/album/${id.toString(16).padStart(32, "0")}?market=from_token`,
      AbortSignal.timeout(6_000));
    if (response.status === 404) return null;
    if (!response.ok) return;
    const data = await response.json() as { external_id?: { type?: string; id?: string }[] };
    return data.external_id?.filter((item) => /^(?:upc|ean|gtin)$/i.test(item.type ?? ""))
      .map((item) => normalizeUpc(item.id)).find(Boolean) ?? null;
  }
  const result = lookup().catch(() => undefined).then((value) => {
    if (value === undefined && upcs.get(album) === result) upcs.delete(album);
    return value;
  });
  upcs.set(album, result);
  if (upcs.size > 64) upcs.delete(upcs.keys().next().value!);
  return result;
}

function appleVideo(value: unknown) {
  if (typeof value !== "string") return;
  const url = new URL(value);
  if (url.protocol === "https:" && url.hostname === "mvod.itunes.apple.com" && !url.port &&
    !url.username && !url.password && url.pathname.toLowerCase().endsWith(".mp4")) return url.href;
}

function coverForUpc(upc: string) {
  const cached = covers.get(upc);
  if (cached && cached.expires > Date.now()) return cached.value;
  const entry = {
    expires: Infinity,
    value: lyssnaRequest(`/v1/motion-artwork?upc=${upc}`).then(async (response) => {
      if (!response?.ok) return;
      const { url } = await response.json();
      const video = appleVideo(url);
      if (video || url === null) {
        const maxAge = /\bmax-age=(\d+)/.exec(response.headers.get("Cache-Control") ?? "")?.[1];
        entry.expires = Date.now() + Number(maxAge ?? (video ? 86400 : 21600)) * 1_000;
      }
      return video;
    }).catch(() => undefined).finally(() => {
      if (entry.expires === Infinity && covers.get(upc) === entry) covers.delete(upc);
    }),
  };
  covers.set(upc, entry);
  if (covers.size > 64) covers.delete(covers.keys().next().value!);
  return entry.value;
}

export function useAlbumMotionArtwork(albumUri: string | undefined, suppliedUpc: string | undefined, enabled: boolean, view: Window = window) {
  const format = useMemo(() => motionArtworkFormat(view), [view]);
  const album = /^spotify:album:([A-Za-z0-9]{22})$/.exec(albumUri ?? "")?.[1];
  const key = enabled && album && format ? `${album}:${format}` : undefined;
  const [art, setArt] = useState<{ key: string; cover: MotionCover }>();
  useEffect(() => {
    if (!key || !album || !format) return;
    const cacheKey = key;
    let live = true;
    let looking = false;
    let timer: number | undefined;
    let objectUrl: string | undefined;
    let unsubscribe: (() => void) | undefined;

    function show(blob: Blob) {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = URL.createObjectURL(blob);
      setArt({ key: cacheKey, cover: { state: "ready", url: objectUrl } });
    }

    async function lookup() {
      if (looking || objectUrl) return;
      looking = true;
      window.clearTimeout(timer);
      const revision = cacheRevision;
      const current = () => live && revision === cacheRevision;
      try {
        await clearing?.catch(() => {});
        if (!current()) return;
        const cached = await readStoredMotionArtwork(cacheKey).catch(() => undefined) ?? recentCovers.get(cacheKey);
        if (!current()) return;
        if (cached) { show(cached); return; }
        const upc = normalizeUpc(suppliedUpc) ?? await albumUpc(album!);
        if (!current() || !upc) return;
        const url = await coverForUpc(upc);
        if (!current()) return;
        if (!url) {
          const delay = lyssnaRetryAt() - Date.now();
          if (!covers.has(upc) && delay > 0 && delay <= 15 * 60_000) timer = window.setTimeout(lookup, delay + 250);
          return;
        }
        const load = loads.get(cacheKey) ?? startCoverLoad(cacheKey, url, format!);
        load.users++;
        const progress = (value?: number) => {
          if (current()) setArt({ key: cacheKey, cover: { state: "loading", progress: value } });
        };
        progress(load.progress);
        load.listeners.add(progress);
        unsubscribe = () => {
          load.listeners.delete(progress);
          if (--load.users === 0 && loads.get(cacheKey) === load) {
            loads.delete(cacheKey);
            load.cancel();
          }
        };
        const blob = await load.result;
        unsubscribe?.();
        unsubscribe = undefined;
        if (current() && blob) show(blob);
        else if (live) setArt(current() && format === "mp4"
          ? { key: cacheKey, cover: { state: "ready", url } } : undefined);
      } finally {
        looking = false;
      }
    }
    window.addEventListener(lyssnaInstallReady, lookup);
    window.addEventListener("online", lookup);
    void lookup();
    return () => {
      live = false;
      window.clearTimeout(timer);
      window.removeEventListener(lyssnaInstallReady, lookup);
      window.removeEventListener("online", lookup);
      unsubscribe?.();
      unsubscribe = undefined;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setArt((current) => current?.key === cacheKey ? undefined : current);
    };
  }, [key, album, format, suppliedUpc]);
  return art && art.key === key ? art.cover : noMotion;
}

function CoverProgress({ value }: { value?: number }) {
  return <div className="lyssna-cover-progress" role="progressbar" aria-label="Loading animated cover"
    aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}>
    <span style={value === undefined ? undefined : { width: `${value}%` }} />
  </div>;
}

export function MotionArtwork({ cover, playing }: { cover: MotionCover; playing: boolean }) {
  if (cover.state === "loading") return <CoverProgress value={cover.progress} />;
  if (cover.state === "ready") return <MotionVideo key={cover.url} url={cover.url} playing={playing} progress={cover.progress} />;
  return null;
}

function MotionVideo({ url, playing, progress }: { url: string; playing: boolean; progress?: number }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const page = video.ownerDocument;
    function sync() {
      if (playing && !page.hidden) void video!.play().catch((error: DOMException) => {
        if (error.name === "NotSupportedError") setFailed(true);
      });
      else video!.pause();
    }
    page.addEventListener("visibilitychange", sync);
    sync();
    return () => page.removeEventListener("visibilitychange", sync);
  }, [playing, url, failed]);
  return failed ? null : <>
    <video ref={ref} className="cover" data-motion-cover="" style={ready ? undefined : { visibility: "hidden" }} src={url} preload="auto"
      onLoadedData={() => setReady(true)}
      muted loop playsInline onError={() => setFailed(true)} aria-label="Apple Music animated cover" />
    {!ready && <CoverProgress value={progress} />}
  </>;
}
