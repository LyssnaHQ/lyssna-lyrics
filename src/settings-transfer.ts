import { listLocalLyrics, saveLocalLyrics } from "./local-lyrics";
import { orderedSources } from "./lyric-sources";
import { cleanAnimatorValues, cleanSavedPresets } from "./lyssna/animator-tuning";
import { downloadTransfer, isRecord, parseTransfer, pluginPreferences, standalonePreferences, TRANSFER_LIMIT, type SettingsTransfer } from "./lyssna/transfer-format";
import { defaults, type Settings } from "./settings";

export async function exportSettings(settings: Settings) {
  const offsets = Object.fromEntries(Object.entries(settings.lyric_song_offsets).map(([id, offset]) => [`spotify:track:${id}`, offset]));
  const { sync_other_plugin_preferences: _sync, ...preferences } = settings;
  const file: SettingsTransfer = {
    format: "lyssna-settings", version: 1, source: "standalone", exportedAt: new Date().toISOString(),
    standalone: { settings: { ...preferences, lyric_song_offsets: offsets } }, lyrics: await listLocalLyrics(),
  };
  const plugin = pluginPreferences(file);
  const { enhancements: _enhancements, ...pluginSettings } = plugin;
  downloadTransfer({ ...file, source: "plugin", plugin: { ...pluginSettings, enhancements: {} } }, "lyssna-lyrics");
}

const choices = {
  theme: ["dark", "light", "system"],
  ttml_reviewer: ["off", "temporary", "always"],
  lyrics_background: ["animated", "static", "cover", "artist", "color", "none"],
  lyrics_pinned_footer: ["off", "no_writers", "full"],
  lyrics_year_position: ["off", "left", "right"],
  fullscreen_always_show: ["none", "controls", "time", "both"],
  fullscreen_volume: ["off", "left", "right", "below"],
  lyrics_word_filter: ["off", "gibberish", "lower", "upper"],
  lyrics_cache_action: ["song", "reload", "all"],
};

export function validatePreferences(input: Record<string, unknown>) {
  const patch: Record<string, unknown> = {};
  for (const [key, fallback] of Object.entries(defaults)) {
    const value = input[key];
    if (value === undefined || key === "sync_other_plugin_preferences") continue;
    if (Object.hasOwn(choices, key)) {
      if (choices[key as keyof typeof choices].includes(String(value))) patch[key] = value;
    } else if (Array.isArray(fallback)) {
      if (Array.isArray(value) && value.every((item) => typeof item === "string")) patch[key] = value;
    } else if (typeof fallback === "number") {
      if (typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 10_000) patch[key] = value;
    } else if (typeof fallback === "string") {
      if (typeof value === "string" && value.length <= 100) patch[key] = value;
    } else if (typeof fallback === "boolean") {
      if (typeof value === "boolean") patch[key] = value;
    } else if (isRecord(value)) {
      patch[key] = value;
    }
  }
  if (patch.lyrics_font_enabled === undefined && typeof patch.custom_fonts_enabled === "boolean") {
    patch.lyrics_font_enabled = patch.custom_fonts_enabled;
  }
  if (Array.isArray(patch.lyrics_source_order)) patch.lyrics_source_order = orderedSources(patch.lyrics_source_order);
  if (isRecord(patch.lyric_song_offsets)) {
    patch.lyric_song_offsets = Object.fromEntries(Object.entries(patch.lyric_song_offsets).flatMap(([uri, offset]) => {
      const id = /^(?:spotify:track:)?([A-Za-z0-9]{22})$/.exec(uri)?.[1];
      return id && typeof offset === "number" && Number.isFinite(offset) && Math.abs(offset) <= 10_000 ? [[id, offset]] : [];
    }));
  }
  if (isRecord(patch.lyrics_animator)) {
    const animator = patch.lyrics_animator;
    patch.lyrics_animator = {
      ...animator,
      ...(Object.hasOwn(animator, "custom") ? { custom: cleanAnimatorValues(animator.custom) } : {}),
      ...(Object.hasOwn(animator, "saved") ? { saved: cleanSavedPresets(animator.saved) } : {}),
    };
  }
  return patch as Partial<Settings>;
}

export async function importSettings(file: File) {
  if (file.size > TRANSFER_LIMIT) throw new Error("Settings files must be under 100 MB.");
  const transfer = parseTransfer(await file.text());
  const patch = validatePreferences(standalonePreferences(transfer));
  const ttml = transfer.lyrics.filter((entry) => entry.kind !== "json" && /^spotify:track:[A-Za-z0-9]{22}$/.test(entry.uri));
  if (ttml.length) await saveLocalLyrics(ttml);
  return { patch, skipped: transfer.lyrics.length - ttml.length };
}
