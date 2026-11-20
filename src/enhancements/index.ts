import { getSettings, hasLegacyLoader, hasStandaloneSpotifyPlus, SETTINGS_CHANGED_EVENT } from "./config";
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

export function externalEnhancementOwner() {
  if (runtime.__LYSSNA_REWRITE_ENHANCEMENTS__) return;
  const standalone = runtime.__SPOTIFY_PLUS_RUNTIME__;
  if (standalone?.state === "active" || (hasStandaloneSpotifyPlus() && standalone?.protocol !== 1)) return "Spotify+";
  const legacy = runtime.__LYSSNA_LYRICS_INTEGRATION__;
  if (legacy?.phase === "loading" || (legacy?.phase !== "standalone" && (hasLegacyLoader() || legacy?.hasEnhancements))) return "Lyssna Lyrics Legacy";
}

// Keep only one set of Spotify interface controllers for the life of the page.
export function startEnhancements() {
  function activate() {
    if (runtime.__LYSSNA_REWRITE_ENHANCEMENTS__) return stop();
    if (externalEnhancementOwner()) return;
    runtime.__LYSSNA_REWRITE_ENHANCEMENTS__ = true;
    stop();
    if (!hasLegacyLoader()) {
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
