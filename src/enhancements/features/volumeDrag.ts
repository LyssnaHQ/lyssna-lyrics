import { spicetify, type Host } from "../../host";
import { getSetting, subscribeSettings } from "../config";

const nativeVolumeBar = '.main-nowPlayingBar-volumeBar[data-testid="volume-bar"]';
const interactiveSlider = '.playback-progressbar-isInteractive [data-testid="progress-bar"]';
const previewProperty = "--lyssna-volume-preview";
const volumeUpdateInterval = 100;

export function startVolumeDragController(host: Host) {
  const player = spicetify()?.Player;
  if (player && (!player.setVolume || !player.getVolume)) return () => {};

  const html = document.documentElement;
  let finishDrag: (() => void) | undefined;
  let clearPreview: (() => void) | undefined;

  function startDrag(event: PointerEvent) {
    if (event.defaultPrevented || event.button !== 0 || !event.isPrimary || finishDrag) return;
    const slider = event.target instanceof Element && event.target.closest<HTMLElement>(interactiveSlider);
    if (!slider || !slider.closest(nativeVolumeBar)) return;
    const track = slider.querySelector<HTMLElement>('[data-testid="progress-bar-background"]');
    const thumb = slider.querySelector<HTMLElement>('[data-testid="progress-bar-handle"]');
    const volume = host.volume();
    if (!track || !thumb || !Number.isFinite(volume) || volume < 0) return;
    const surface = slider;
    const rail = track;
    let rect = track.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    try { slider.setPointerCapture(event.pointerId); }
    catch { return; }
    event.preventDefault();
    event.stopImmediatePropagation();
    clearPreview?.();

    const listeners = new AbortController();
    const options = { capture: true, signal: listeners.signal };
    let pointer = event;
    let frame = 0;
    let writeTimer = 0;
    let needsMeasure = false;
    let lastLevel = Math.round(volume * 1000) / 1000;
    let lastWrite = -Infinity;
    let level = volume;
    const invalidate = () => { needsMeasure = true; };
    const geometry = new ResizeObserver(invalidate);
    geometry.observe(track);

    function writeVolume(now: number, final = false) {
      if (level === lastLevel || !surface.isConnected) return;
      const wait = volumeUpdateInterval - (now - lastWrite);
      if (!final && wait > 0) {
        writeTimer ||= window.setTimeout(() => {
          writeTimer = 0;
          writeVolume(performance.now());
        }, Math.ceil(wait));
        return;
      }
      lastLevel = level;
      lastWrite = now;
      host.setVolume(level);
    }

    function apply(now: number, final = false) {
      if (needsMeasure) {
        needsMeasure = false;
        rect = rail.getBoundingClientRect();
      }
      if (!rect.width || !rect.height) return;
      const vertical = rect.height > rect.width;
      const fraction = vertical
        ? (rect.bottom - pointer.clientY) / rect.height
        : (pointer.clientX - rect.left) / rect.width;
      level = Math.round(Math.max(0, Math.min(1, fraction)) * 1000) / 1000;
      surface.style.setProperty(previewProperty, `${level * 100}%`);
      surface.style.setProperty("--lyssna-volume-thumb", `${level * (vertical ? rect.height : rect.width)}px`);
      writeVolume(now, final);
    }

    function finish() {
      listeners.abort();
      geometry.disconnect();
      cancelAnimationFrame(frame);
      window.clearTimeout(writeTimer);
      finishDrag = undefined;
      surface.removeAttribute("data-lyssna-volume-dragging");
      if (surface.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId);
      // Spotify can acknowledge the final volume asynchronously.
      const timeout = window.setTimeout(() => clearPreview?.(), volumeUpdateInterval);
      clearPreview = () => {
        window.clearTimeout(timeout);
        surface.style.removeProperty(previewProperty);
        surface.style.removeProperty("--lyssna-volume-thumb");
        surface.removeAttribute("data-lyssna-volume-preview");
        clearPreview = undefined;
      };
    }
    function onMove(move: PointerEvent) {
      if (move.pointerId !== event.pointerId) return;
      move.stopImmediatePropagation();
      pointer = move;
      frame ||= requestAnimationFrame((now) => {
        frame = 0;
        apply(now);
      });
    }
    function onUp(up: PointerEvent) {
      if (up.pointerId !== event.pointerId) return;
      up.stopImmediatePropagation();
      pointer = up;
      try { apply(performance.now(), true); }
      finally { finish(); }
    }
    function onCancel(cancel: PointerEvent) {
      if (cancel.pointerId === event.pointerId) finish();
    }

    finishDrag = finish;
    window.addEventListener("pointermove", onMove, options);
    window.addEventListener("pointerup", onUp, options);
    window.addEventListener("pointercancel", onCancel, options);
    slider.addEventListener("lostpointercapture", onCancel, options);
    window.addEventListener("resize", invalidate, options);
    window.addEventListener("scroll", invalidate, options);
    window.addEventListener("blur", finish, options);
    window.addEventListener("pagehide", finish, options);
    slider.setAttribute("data-lyssna-volume-preview", "");
    slider.setAttribute("data-lyssna-volume-dragging", "");
    try { apply(performance.now()); }
    catch (error) { finish(); throw error; }
  }

  function stop() {
    window.removeEventListener("pointerdown", startDrag, true);
    finishDrag?.();
    clearPreview?.();
    html.classList.remove("lyssna-optimize-volume");
  }
  function sync() {
    if (!getSetting("enhanceSpotifyPerformance")) return stop();
    html.classList.add("lyssna-optimize-volume");
    window.addEventListener("pointerdown", startDrag, true);
  }
  const unsubscribe = subscribeSettings(sync);
  sync();
  return () => { unsubscribe(); stop(); };
}
