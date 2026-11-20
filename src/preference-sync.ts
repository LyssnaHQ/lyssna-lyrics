import { storage } from "./enhancements/compat";
import { enhancementPreferences, hasLegacyLoader, hasStandaloneSpotifyPlus, initializeEnhancementPreferences, readSpotifyPlusPreferences, saveEnhancementPreferences } from "./enhancements/config";
import { isRecord, standalonePreferences, type SettingsRecord } from "./lyssna/transfer-format";
import { legacyPreferencesMigrated, readSettings, saveSettings, settingsEvent, type Settings } from "./settings";
import { validatePreferences } from "./settings-transfer";
import { standaloneSpicyInstalled } from "./spicy";

// Only these compatible upstream keys are shared when Legacy is attached to Spicy Lyrics.
const sharedSettings = [
  "animationFpsCap", "animationFpsCapEnabled", "creditsFollowLastLine", "disableNpvLyrics", "duetLinePadding",
  "experiment:canvasImmersive", "experiment:keepOverlappingLines", "experiment:lyricsSkeleton", "experiment:newProgressBarStyling",
  "hideNpvLyricsWhenUnavailable", "lineHoverBackground", "lyricsSize", "minimalLyricsMode", "playbackOffset",
  "releaseYearPosition", "removeSpotifyLyricsButton", "rendererVisualStyle", "romanizationDisplay", "scrollLeadEnabled",
  "scrollLeadMs", "seekFadeCompensation", "showNoLyricsNotice", "showNpvDynamicBg", "showScrollToActive", "smoothScrolling", "viewControlsPosition",
];

function select(record: SettingsRecord | undefined, keys: string[]) {
  return Object.fromEntries(keys.filter((key) => record && Object.hasOwn(record, key)).map((key) => [key, record?.[key]]));
}

function sourceList(value: unknown) {
  try {
    const items: unknown = typeof value === "string" ? JSON.parse(value) : value;
    if (Array.isArray(items) && items.every((item) => typeof item === "string")) return items;
  } catch { /* Skip an invalid list while importing other preferences. */ }
}

function convert(settings: SettingsRecord, uiState: SettingsRecord, offsets: SettingsRecord | undefined) {
  const order = sourceList(settings.lyricsSourceOrder);
  const input = standalonePreferences({
    format: "lyssna-settings", version: 1, source: "plugin", exportedAt: "", lyrics: [],
    plugin: {
      settings: {
        ...settings,
        showScrollToActiveButton: settings.showScrollToActiveButton ?? settings.showScrollToActive,
        lyricsSourceOrder: order && ["local", ...order],
        disabledLyricsSources: sourceList(settings.disabledLyricsSources),
      },
      uiState: { ...uiState, forceCompactMode: uiState.forceCompactMode ?? uiState.ForceCompactMode },
      songOffsets: (offsets ?? {}) as Record<string, number>, enhancements: {}, playlistFolders: [],
    },
  });
  if (!offsets) delete input.lyric_song_offsets;
  return validatePreferences(input);
}

function changedPreferences<T extends object>(current: T, previous?: T): Partial<T> {
  return Object.fromEntries(Object.entries(current).filter(([key, value]) =>
    JSON.stringify(value) !== JSON.stringify(previous?.[key as keyof T]))) as Partial<T>;
}

type Snapshot = { lyrics: Partial<Settings>; enhancements: ReturnType<typeof enhancementPreferences> };

export function startPreferenceSync() {
  let migrated = legacyPreferencesMigrated();
  let enabled = false;
  let timer: number | undefined;
  let previous: Snapshot | undefined;
  let running = false;
  let warned = false;
  let initializedEnhancements = false;
  const records = new Map<string, { raw: string; value?: SettingsRecord }>();

  function read(key: string) {
    const raw = storage.get(key);
    if (raw == null) { records.delete(key); return; }
    const cached = records.get(key);
    if (cached?.raw === raw) return cached.value;
    let value: SettingsRecord | undefined;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isRecord(parsed)) value = parsed;
    } catch { /* Leave invalid external data in place. */ }
    records.set(key, { raw, value });
    return value;
  }

  function fromLegacy(installed: boolean): Snapshot | undefined {
    const settings = read("LL:settings");
    const uiState = read("LL:uiState");
    const enhancements = read("LL:enhancements");
    if (!settings && !uiState && (!installed || !enhancements)) return;
    const detached = settings?.dontSyncSpicySettings === true;
    const preferences = { ...settings, ...(!detached && select(read("SL:settings"), sharedSettings)) };
    const ui = { ...uiState, ...(!detached && select(read("SL:uiState"), ["romanization", "forceCompactMode", "ForceCompactMode"])) };
    const offsets = read("SL:songOffsets");
    return {
      lyrics: convert(preferences, ui, offsets),
      enhancements: enhancementPreferences({ ...enhancements, hideLyricsButton: preferences.removeSpotifyLyricsButton ?? enhancements?.hideLyricsButton }),
    };
  }

  function apply(snapshot: Snapshot, settings: Settings, migration: boolean) {
    const patch = changedPreferences(snapshot.lyrics, previous?.lyrics);
    if (patch.lyrics_sources_disabled && settings.lyrics_sources_disabled.includes("local") && !patch.lyrics_sources_disabled.includes("local")) {
      patch.lyrics_sources_disabled = [...patch.lyrics_sources_disabled, "local"];
    }
    if (patch.lyrics_animator) {
      patch.lyrics_animator = { ...settings.lyrics_animator, ...changedPreferences(patch.lyrics_animator, previous?.lyrics.lyrics_animator) };
    }
    if (patch.lyric_song_offsets) {
      const offsets = { ...settings.lyric_song_offsets };
      const external = patch.lyric_song_offsets;
      for (const [id, offset] of Object.entries(previous?.lyrics.lyric_song_offsets ?? {})) {
        if (!Object.hasOwn(external, id) && offsets[id] === offset) delete offsets[id];
      }
      for (const [id, offset] of Object.entries(external)) {
        if (offset !== previous?.lyrics.lyric_song_offsets?.[id]) offsets[id] = offset;
      }
      patch.lyric_song_offsets = offsets;
    }
    saveEnhancementPreferences(changedPreferences(snapshot.enhancements, previous?.enhancements));
    if (migration || Object.keys(changedPreferences(patch, settings)).length) {
      saveSettings({ ...settings, ...patch }, migrated || migration);
    }
    previous = snapshot;
  }

  function refresh() {
    if (running) return;
    running = true;
    let legacy = false;
    try {
      if (!initializedEnhancements) {
        initializeEnhancementPreferences();
        initializedEnhancements = true;
      }
      const settings = readSettings();
      const wasEnabled = enabled;
      enabled = settings.sync_other_plugin_preferences;
      if (enabled !== wasEnabled) previous = undefined;
      if (migrated && !enabled) return;
      legacy = hasLegacyLoader();
      const initial = !migrated ? fromLegacy(legacy) : undefined;
      if (initial) {
        apply(initial, settings, true);
        migrated = true;
        previous = undefined;
      }
      if (enabled) {
        const external = legacy ? fromLegacy(true) : undefined;
        const lyrics = external?.lyrics ?? (standaloneSpicyInstalled()
          ? convert(select(read("SL:settings"), sharedSettings), read("SL:uiState") ?? {}, read("SL:songOffsets")) : {});
        const enhancements = { ...external?.enhancements, ...(hasStandaloneSpotifyPlus() && readSpotifyPlusPreferences(read)) };
        apply({ lyrics, enhancements }, initial ? readSettings() : settings, false);
      }
      warned = false;
    } catch (error) {
      if (!warned) console.warn("[Lyssna Lyrics] Could not apply external preferences:", error);
      warned = true;
    } finally {
      running = false;
      if (enabled || (!migrated && legacy)) timer ??= window.setInterval(refresh, 2_000);
      else if (timer !== undefined) { window.clearInterval(timer); timer = undefined; }
    }
  }

  window.addEventListener(settingsEvent, refresh);
  window.addEventListener("lyssna-lyrics:integration-state", refresh);
  window.addEventListener("lyssna-lyrics:enhancements-changed", refresh);
  window.addEventListener("spotify-plus:settings-changed", refresh);
  refresh();
  return () => {
    window.clearInterval(timer);
    window.removeEventListener(settingsEvent, refresh);
    window.removeEventListener("lyssna-lyrics:integration-state", refresh);
    window.removeEventListener("lyssna-lyrics:enhancements-changed", refresh);
    window.removeEventListener("spotify-plus:settings-changed", refresh);
  };
}
