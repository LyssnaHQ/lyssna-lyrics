import { cleanAnimatorValues, cleanSavedPresets, type AnimatorSettings } from "./lyssna/animator-tuning";
import type { WordFilter } from "./lyssna/word-filter";

export const defaults = {
  theme: "dark" as "dark" | "light" | "system",
  liquid_glass: false,
  ui_font: "",
  lyric_size: 36,
  lyric_font: "",
  lyric_offset_ms: 0,
  lyric_song_offsets: {} as Record<string, number>,
  reduce_motion: false,
  cover_animation: true,
  canvas_lyrics: true,
  lyrics_visualiser: false,
  lyrics_visualiser_opacity: 40,
  animation_fps_cap_enabled: false,
  animation_fps_cap: 60,
  glass_seek: true,
  romanized: false,
  romanization_below: true,
  lyrics_translations: false,
  experimental_word_sync: false,
  lyrics_animator: {} as AnimatorSettings,
  lyrics_background: "animated" as "animated" | "static" | "cover" | "artist" | "color" | "none",
  lyrics_background_blur: 0,
  lyrics_pinned_footer: "off" as "off" | "no_writers" | "full",
  lyrics_year_position: "left" as "off" | "left" | "right",
  lyrics_seek_compensation: true,
  lyrics_simple: false,
  lyrics_minimal: false,
  lyrics_keep_overlaps: true,
  lyrics_early_scroll: true,
  lyrics_early_scroll_ms: 200,
  lyrics_smooth_scroll: true,
  lyrics_follow_button: true,
  lyrics_right_align: false,
  lyrics_flip_duet: false,
  lyrics_wide_duet: true,
  lyrics_credits_follow: false,
  lyrics_line_hover: false,
  lyrics_skeleton: true,
  lyrics_no_lyrics_notice: true,
  lyrics_discord_usernames: false,
  lyrics_word_filter: "off" as WordFilter,
  space_gravity: false,
  lyrics_highlighter: false,
  pinned_lyric_effects: [] as string[],
  lyrics_highlighter_color: "#d4b80f",
  gravity_links: true,
  gravity_link_width: 100,
  lyrics_compact: false,
  cinema_lyrics: true,
  cinema_window: false,
  lyrics_hide_artwork: false,
  lyrics_artwork_right: false,
  lyrics_up_next: true,
  lyrics_toolbar_bottom: false,
  fullscreen_always_show: "none" as "none" | "controls" | "time" | "both",
  fullscreen_volume: "off" as "off" | "left" | "right" | "below",
  fullscreen_animate_close: false,
  lyrics_escape_exits: false,
  lyrics_hide_npv: false,
  lyrics_hide_npv_empty: false,
  npv_ambience: true,
  lyrics_cache_button: true,
  lyrics_cache_action: "song" as "song" | "reload" | "all",
  lyrics_source_order: ["local", "spicy", "apple", "lrcred", "lrclib", "netease"] as string[],
  lyrics_sources_disabled: ["lrcred", "lrclib", "netease"] as string[],
  lyrics_prefer_apple: true,
  sync_other_plugin_preferences: false,
  settings_remember_place: true,
  settings_allow_hiding: false,
  settings_hide_buttons: true,
  hidden_settings: [] as string[],
};

export type Settings = typeof defaults;
const key = "lyssna-lyrics.settings.v1";
export const settingsEvent = "lyssna-lyrics:settings";
type StoredSettings = Partial<Settings> & { legacy_preferences_migrated?: boolean; desktop_animator_default_applied?: boolean };

function readRecord() {
  const saved = JSON.parse(localStorage.getItem(key) ?? "null") as StoredSettings | null;
  return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
}

export function legacyPreferencesMigrated() {
  try { return readRecord().legacy_preferences_migrated === true; }
  catch { return false; }
}

export function readSettings(): Settings {
  try {
    const { legacy_preferences_migrated: _migrated, desktop_animator_default_applied: _animator, ...saved } = readRecord();
    const settings = { ...defaults, ...saved };
    const animator = settings.lyrics_animator;
    settings.lyrics_animator = animator ? {
      ...animator,
      custom: cleanAnimatorValues(animator.custom),
      saved: cleanSavedPresets(animator.saved),
    } : {};
    return settings;
  } catch {
    return { ...defaults };
  }
}

export function restoreDesktopAnimatorDefault() {
  let saved: StoredSettings;
  try { saved = readRecord(); }
  catch { return; }
  if (!saved.legacy_preferences_migrated || saved.desktop_animator_default_applied ||
      saved.sync_other_plugin_preferences || saved.lyrics_animator?.preset !== "Legacy") return;
  const settings = readSettings();
  saveSettings({ ...settings, lyrics_animator: { ...settings.lyrics_animator, preset: "Lyssna" } }, true);
}

export function saveSettings(settings: Settings, migrated = legacyPreferencesMigrated()) {
  localStorage.setItem(key, JSON.stringify({ ...settings, legacy_preferences_migrated: migrated, desktop_animator_default_applied: true }));
  window.dispatchEvent(new Event(settingsEvent));
}
