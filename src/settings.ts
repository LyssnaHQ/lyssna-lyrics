import { cleanAnimatorValues, cleanSavedPresets, type AnimatorSettings } from "./lyssna/animator-tuning";
import type { WordFilter } from "./lyssna/word-filter";

export const defaults = {
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
  lyrics_highlighter_color: "#d4b80f",
  gravity_links: true,
  gravity_link_width: 100,
  lyrics_compact: false,
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
};

export type Settings = typeof defaults;
const key = "lyssna-lyrics.settings.v1";
export const settingsEvent = "lyssna-lyrics:settings";

export function readSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? "null") as Partial<Settings> | null;
    if (!saved || typeof saved !== "object") return { ...defaults };
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

export function saveSettings(settings: Settings) {
  localStorage.setItem(key, JSON.stringify(settings));
  window.dispatchEvent(new Event(settingsEvent));
}
