import type { Host, Track } from "./host";
import { isLocalArtwork } from "./lyssna/local-artwork";

const panelContent = '[data-testid="NPV_Panel_OpenDiv"]';
const nativePreview = '[data-testid="lyrics-npv-section"]';
const trackVisual = '[data-testid="track-visual-enhancement"]';
const canvasSurface = '[data-canvas-surface], .main-nowPlayingView-canvasVisualEnhancement, .canvasVideoContainerNPV';
const nowPlayingWidget = '[data-testid="now-playing-widget"], [data-testid="now-playing-widget-v2"], .main-nowPlayingWidget-nowPlaying';

export function findPlaybarCover(page: Document = document) {
  return page.querySelector<HTMLElement>(
    `:is(${nowPlayingWidget}) .cover-art:has(> img)`,
  );
}

export function findLocalPlaybarArtwork(track: Track) {
  const cover = findPlaybarCover();
  const widget = cover?.closest(nowPlayingWidget);
  const image = cover?.querySelector<HTMLImageElement>(":scope > img");
  if (!widget || !image?.complete || !image.naturalWidth) return;
  const url = image.currentSrc || image.src;
  if (!isLocalArtwork(url)) return;
  const info = widget.querySelector(".main-nowPlayingWidget-trackInfo");
  const title = widget.querySelector('[data-testid="context-item-link"], .main-trackInfo-name')?.textContent?.trim();
  const artist = widget.querySelector('[data-testid="now-playing-widget-v2-byline"], .main-trackInfo-artists')?.textContent?.trim();
  const labels = Array.from(info?.children ?? [], child => child.textContent.trim());
  const matchesTitle = title ? title === track.title : labels.includes(track.title);
  const matchesText = (text: string | undefined) => !!text && (text === track.artist || text === track.artists);
  const matchesArtist = artist ? matchesText(artist) : labels.some(matchesText);
  if (matchesTitle && matchesArtist) return url;
}

export function findNowPlayingCover(panel: HTMLElement | null) {
  if (!panel || panel.querySelector(canvasSurface)) return null;
  return panel.querySelector<HTMLElement>(
    ':is([data-testid="cover-art-slot"], .main-nowPlayingView-coverArtContainer):has(img):not(:has(video:not(.lyssna-spotify-motion-cover video)))',
  );
}

export function findNowPlaying() {
  return document.querySelector<HTMLElement>(
    `aside.NowPlayingView, aside[aria-label="Now playing view" i], aside#Desktop_PanelContainer_Id:has(${panelContent}, ${trackVisual}, [data-canvas-surface], [data-testid="cover-art-slot"]), .now-playing-view`,
  ) ?? document.querySelector<HTMLElement>(panelContent);
}

export function nowPlayingCanvas(panel: HTMLElement) {
  if (panel.classList.contains("lyssna-npv-expanded-panel")) return;
  const video = panel.querySelector<HTMLVideoElement>(`:is(${canvasSurface}) video, video:is(${canvasSurface})`);
  if (video && video.readyState >= video.HAVE_CURRENT_DATA && !video.closest(".lyssna-npv-album-artwork")) return video;
}

export function placeNowPlayingPreview(panel: HTMLElement, preview: HTMLElement) {
  const stock = panel.querySelector(nativePreview);
  if (stock) {
    if (stock.previousElementSibling !== preview) stock.before(preview);
    return;
  }

  const content = panel.querySelector(panelContent) ?? panel;
  // When Spotify has no preview for the track, place ours after the song
  // header or artwork, ahead of the sidebar's other sections.
  const header = content.querySelector(`.main-nowPlayingView-nowPlayingWidget, .main-trackInfo-container, ${trackVisual}, [data-testid="cover-art-slot"], [data-canvas-surface]`);
  let section = header;
  while (section?.parentElement && section.parentElement !== content) section = section.parentElement;
  if (section?.parentElement === content) {
    if (section.nextElementSibling !== preview) section.after(preview);
  } else if (preview.parentElement !== content) content.append(preview);
}

export function nowPlayingArtistCard(host: Host) {
  let active: { layout: Element; name: HTMLAnchorElement; artistUri: string; parts: Element[]; clear(): void } | undefined;
  function clear() {
    active?.clear();
    active = undefined;
  }

  return {
    sync(panel: HTMLElement | null) {
      const section = panel?.querySelector(":is(.main-nowPlayingView-aboutArtist, .main-nowPlayingView-aboutArtistV2)");
      const name = section?.querySelector<HTMLAnchorElement>('a[href*="/artist/"]');
      const id = name?.pathname.match(/\/artist\/([A-Za-z0-9]{22})\/?$/)?.[1];
      const details = name?.parentElement;
      const layout = details?.parentElement;
      const artistUri = id && `spotify:artist:${id}`;
      if (active && layout === active.layout && active.name === name && active.artistUri === artistUri &&
          active.parts.every((part) => layout.contains(part))) return;
      clear();

      const portrait = details?.previousElementSibling;
      const stats = Array.from(details?.children ?? []).find((element) => element.matches("div:has(> button)"));
      const bio = stats?.nextElementSibling;
      if (!name || !artistUri || !layout || !details || !portrait?.querySelector("button") || !stats || !bio) return;

      const track = host.track();
      const photo = host.artistGalleryPhoto(artistUri, track?.artistUri === artistUri ? track.id : undefined);
      if (!photo) return;

      const image = layout.ownerDocument.createElement("img");
      image.className = "lyssna-npv-artist-photo";
      image.alt = "";
      image.decoding = "async";
      const parts = [
        [layout, "layout"], [portrait, "portrait"], [details, "details"],
        [name, "name"], [stats, "stats"], [bio, "bio"],
      ] as const;
      const entry = active = { layout, name, artistUri, parts: parts.map(([element]) => element), clear() {
        image.removeEventListener("load", show);
        image.remove();
        for (const [element, part] of parts) element.classList.remove(`lyssna-npv-artist-${part}`);
      } };
      function show() {
        if (active !== entry || !layout?.isConnected || !entry.parts.every((part) => layout.contains(part))) return;
        for (const [element, part] of parts) element.classList.add(`lyssna-npv-artist-${part}`);
        portrait?.append(image);
      }
      void photo.then((url) => {
        if (!url || active !== entry) return;
        image.addEventListener("load", show, { once: true });
        image.src = url;
      });
    },
    dispose: clear,
  };
}

export function nowPlayingArtwork(isPlaying: () => boolean) {
  let shown: { surface: HTMLElement; cover: string; image: HTMLImageElement; clear(): void } | undefined;

  function clear() {
    shown?.clear();
    shown = undefined;
  }

  return {
    sync(panel?: HTMLElement | null, cover?: string) {
      const canvas = cover ? panel?.querySelector<HTMLElement>(canvasSurface) : undefined;
      const surface = canvas?.closest<HTMLElement>(`div:has(> ${trackVisual})`) ??
        canvas?.closest<HTMLElement>(".main-nowPlayingView-canvasContainer, .main-nowPlayingView-coverArtContainer") ??
        (canvas instanceof HTMLVideoElement ? canvas.parentElement : canvas);
      if (shown && shown.surface === surface && shown.cover === cover && shown.image.parentElement === surface) return;
      clear();
      if (!surface || !cover) return;

      const image = surface.ownerDocument.createElement("img");
      image.className = "lyssna-npv-album-cover";
      image.alt = "Album artwork";
      image.decoding = "async";
      const paused = new Set<HTMLVideoElement>();
      function pause(video: HTMLVideoElement) {
        if (video.paused) return;
        paused.add(video);
        video.pause();
      }
      const onPlay = (event: Event) => {
        if (event.target instanceof HTMLVideoElement) pause(event.target);
      };
      const show = () => {
        if (shown?.image !== image || !image.naturalWidth) return;
        surface.classList.add("lyssna-npv-album-artwork");
        surface.addEventListener("play", onPlay, true);
        surface.querySelectorAll("video").forEach(pause);
      };
      shown = { surface, cover, image, clear() {
        image.removeEventListener("load", show);
        surface.removeEventListener("play", onPlay, true);
        surface.classList.remove("lyssna-npv-album-artwork");
        image.remove();
        if (isPlaying()) for (const video of paused) {
          if (video.isConnected) void video.play().catch(() => {});
        }
      } };
      image.addEventListener("load", show);
      image.src = cover;
      surface.append(image);
      if (image.complete) show();
    },
    dispose: clear,
  };
}
