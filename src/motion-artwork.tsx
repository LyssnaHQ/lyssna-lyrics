import { useEffect, useRef, useState } from "react";
import { lyssnaInstallReady, lyssnaRequest, lyssnaRetryAt } from "./lyssna-api";
import { fetchSpotifyMedia } from "./spotify-media";

const digits = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const upcs = new Map<string, Promise<string | null | undefined>>();
const covers = new Map<string, { expires: number; value: Promise<string | undefined> }>();

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
    if (value === undefined) upcs.delete(album);
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

export function useMotionArtwork(albumUri: string | undefined, suppliedUpc: string | undefined, enabled: boolean) {
  const [art, setArt] = useState<{ album: string; url: string }>();
  useEffect(() => {
    const album = /^spotify:album:([A-Za-z0-9]{22})$/.exec(albumUri ?? "")?.[1];
    if (!enabled || !album || !albumUri) return;
    let current = true;
    let generation = 0;
    let timer: number | undefined;
    async function lookup() {
      window.clearTimeout(timer);
      const latest = ++generation;
      const upc = normalizeUpc(suppliedUpc) ?? await albumUpc(album!);
      if (!current || !upc) return;
      const url = await coverForUpc(upc);
      if (!current || latest !== generation) return;
      setArt(url ? { album: albumUri!, url } : undefined);
      const delay = lyssnaRetryAt() - Date.now();
      if (!url && !covers.has(upc) && delay > 0 && delay <= 15 * 60_000) {
        timer = window.setTimeout(lookup, delay + 250);
      }
    }
    window.addEventListener(lyssnaInstallReady, lookup);
    window.addEventListener("online", lookup);
    void lookup();
    return () => {
      current = false;
      window.clearTimeout(timer);
      window.removeEventListener(lyssnaInstallReady, lookup);
      window.removeEventListener("online", lookup);
    };
  }, [albumUri, suppliedUpc, enabled]);
  return enabled && art?.album === albumUri ? art?.url : undefined;
}

export function MotionArtwork({ url, cover, playing, onUnavailable }: {
  url: string; cover?: string; playing: boolean; onUnavailable(url: string): void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const page = video.ownerDocument;
    function sync() {
      if (playing && !page.hidden) void video!.play().catch(() => {});
      else video!.pause();
    }
    page.addEventListener("visibilitychange", sync);
    sync();
    return () => page.removeEventListener("visibilitychange", sync);
  }, [playing, url]);
  return <video ref={ref} className="cover" src={url} poster={cover || undefined} preload="metadata"
    muted loop playsInline onError={() => onUnavailable(url)} aria-label="Apple Music animated cover" />;
}
