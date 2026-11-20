import { configuredExtensions, getSettings, hasStandaloneSpotifyPlus, SETTINGS_CHANGED_EVENT } from "./config";
import { startProfileMenuController } from "./features/profileMenu";
import { startPlaylistMenuController } from "./features/playlistMenu";
import { startDisablePeekController } from "./features/disablePeek";
import { startDevicePickerController } from "./features/devicePicker";
import { startShareMenuController } from "./features/shareMenu";
import styles from "./styles.css?inline";

const integrationEvent = "lyssna-lyrics:integration-state";
const runtimeEvent = "spotify-plus:runtime-state";
const runtime = window as Window & {
  __LYSSNA_LYRICS_INTEGRATION__?: { protocol: number; phase: string; hasEnhancements: boolean };
  __SPOTIFY_PLUS_RUNTIME__?: { protocol: number; state: string };
  __LYSSNA_REWRITE_ENHANCEMENTS__?: true;
};

export function legacyOwnsEnhancements() {
  return !runtime.__LYSSNA_REWRITE_ENHANCEMENTS__ &&
    runtime.__LYSSNA_LYRICS_INTEGRATION__?.hasEnhancements === true &&
    runtime.__LYSSNA_LYRICS_INTEGRATION__.phase !== "standalone" &&
    runtime.__SPOTIFY_PLUS_RUNTIME__?.state !== "active";
}

// The controllers own Spotify chrome for the life of the page, including when
// Lyssna switches builds. Legacy and Spotify+ use the same preferences.
export function startEnhancements() {
  const legacy = configuredExtensions().some((file) => /(?:^|[/\\])lyssna-lyrics-legacy\.(?:js|mjs)$/i.test(file.trim()));
  function activate() {
    if (runtime.__LYSSNA_REWRITE_ENHANCEMENTS__) return stop();
    const integration = runtime.__LYSSNA_LYRICS_INTEGRATION__;
    if (legacy && integration?.phase !== "standalone") return;
    if (integration?.hasEnhancements && integration.phase !== "standalone") return;
    const standalone = runtime.__SPOTIFY_PLUS_RUNTIME__;
    if (standalone?.state === "active" || (hasStandaloneSpotifyPlus() && standalone?.protocol !== 1)) return;
    runtime.__LYSSNA_REWRITE_ENHANCEMENTS__ = true;
    stop();
    if (!legacy) {
      runtime.__LYSSNA_LYRICS_INTEGRATION__ = { protocol: 1, phase: "integrated", hasEnhancements: true };
      window.dispatchEvent(new Event(integrationEvent));
    }
    const style = document.createElement("style");
    style.textContent = styles;
    document.head.append(style);
    function syncVisibility() {
      const settings = getSettings();
      for (const key of ["hideFriendActivityButton", "hideLyricsButton", "hideMiniplayerButton"] as const) {
        document.documentElement.classList.toggle(`ll-enhancements-${key}`, settings[key]);
      }
    }
    window.addEventListener(SETTINGS_CHANGED_EVENT, syncVisibility);
    syncVisibility();
    for (const start of [startProfileMenuController, startPlaylistMenuController, startDisablePeekController, startDevicePickerController, startShareMenuController]) {
      try { start(); } catch (error) { console.warn("[Lyssna Lyrics] Enhancement unavailable:", error); }
    }
  }
  function stop() {
    window.removeEventListener(integrationEvent, activate);
    window.removeEventListener(runtimeEvent, activate);
  }
  window.addEventListener(integrationEvent, activate);
  window.addEventListener(runtimeEvent, activate);
  activate();
  return stop;
}
