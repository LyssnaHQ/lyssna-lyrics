const panelContent = '[data-testid="NPV_Panel_OpenDiv"]';
const nativePreview = '[data-testid="lyrics-npv-section"]';
const trackVisual = '[data-testid="track-visual-enhancement"]';
const canvasSurface = '[data-canvas-surface], .main-nowPlayingView-canvasVisualEnhancement, .canvasVideoContainerNPV';

export function findNowPlaying() {
  return document.querySelector<HTMLElement>(
    `aside.NowPlayingView, aside[aria-label="Now playing view" i], aside#Desktop_PanelContainer_Id:has(${panelContent}, ${trackVisual}, [data-canvas-surface], [data-testid="cover-art-slot"]), .now-playing-view`,
  ) ?? document.querySelector<HTMLElement>(panelContent);
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
