import { useSyncExternalStore } from "react";
import { hasTemporaryTtml, lyricsChanged } from "./local-lyrics";
import { defaults, type Settings } from "./settings";

const defaultKeys = [
  "lyric_size", "lyric_font", "lyric_offset_ms", "lyric_song_offsets",
  "lyrics_early_scroll", "lyrics_early_scroll_ms", "lyrics_smooth_scroll", "lyrics_simple",
  "lyrics_minimal", "lyrics_keep_overlaps", "lyrics_line_hover", "lyrics_wide_duet", "lyrics_credits_follow",
  "space_gravity", "lyrics_highlighter", "lyrics_word_filter", "lyrics_animator", "experimental_word_sync",
  "lyrics_background_blur", "romanized", "lyrics_translations",
] as const satisfies readonly (keyof Settings)[];

const profile: Partial<Settings> = {
  ...Object.fromEntries(defaultKeys.map((key) => [key, defaults[key]])),
  lyrics_seek_compensation: false,
  lyrics_background: "color",
  canvas_lyrics: false,
  animated_covers: false,
  lyrics_visualiser: false,
  npv_ambience: false,
  lyrics_up_next: false,
};

function subscribe(update: () => void) {
  window.addEventListener(lyricsChanged, update);
  return () => window.removeEventListener(lyricsChanged, update);
}

export function useReviewerSettings(settings: Settings, trackId?: string): Settings {
  const temporary = useSyncExternalStore(subscribe, () => hasTemporaryTtml(trackId));
  const active = settings.ttml_reviewer === "always" ||
    (settings.ttml_reviewer === "temporary" && temporary && !settings.lyrics_sources_disabled.includes("local"));
  return active ? { ...settings, ...profile } : settings;
}
