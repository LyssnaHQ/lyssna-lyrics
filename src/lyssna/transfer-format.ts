// Version 1 wire format shared by both Lyssna apps.
export type SettingsRecord = Record<string, unknown>;
export type TransferLyrics = {
  uri: string;
  kind: "ttml" | "lrc" | "json";
  text: string;
  key?: string;
  name?: string;
  artists?: string;
  image?: string;
};
export type PluginPreferences = {
  settings: SettingsRecord;
  uiState: SettingsRecord;
  songOffsets: Record<string, number>;
  enhancements: SettingsRecord;
  playlistFolders: unknown[];
};
export type SettingsTransfer = {
  format: "lyssna-settings";
  version: 1;
  source: "plugin" | "standalone";
  exportedAt: string;
  plugin?: PluginPreferences;
  standalone?: { settings: SettingsRecord; storage?: Record<string, string> };
  lyrics: TransferLyrics[];
};

export const TRANSFER_LIMIT = 100 * 1024 * 1024;
export function isRecord(value: unknown): value is SettingsRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function requireRecord(value: unknown, name: string): asserts value is SettingsRecord {
  if (!isRecord(value)) throw new Error(`Invalid ${name} in the settings file.`);
}
export function parseTransfer(text: string): SettingsTransfer {
  if (new TextEncoder().encode(text).length > TRANSFER_LIMIT) throw new Error("Settings files must be under 100 MB.");
  const value: unknown = JSON.parse(text, (key, item) => {
    if (["__proto__", "prototype", "constructor"].includes(key)) throw new Error("Unsafe key in the settings file.");
    return item;
  });
  requireRecord(value, "file");
  if (value.format !== "lyssna-settings" || value.version !== 1) throw new Error("Choose a supported Lyssna settings export (version 1).");
  if (value.source !== "plugin" && value.source !== "standalone") throw new Error("Unknown settings source.");
  if (!value[value.source] || (!value.plugin && !value.standalone)) throw new Error("The export is missing its settings.");
  if (value.plugin !== undefined) {
    requireRecord(value.plugin, "plugin preferences");
    for (const key of ["settings", "uiState", "songOffsets", "enhancements"]) requireRecord(value.plugin[key], key);
    if (!Array.isArray(value.plugin.playlistFolders)) throw new Error("Invalid playlist folders.");
    for (const [uri, offset] of Object.entries(value.plugin.songOffsets as SettingsRecord)) {
      if (!uri || uri.length > 512 || typeof offset !== "number" || !Number.isFinite(offset) || Math.abs(offset) > 10_000) throw new Error("Invalid per-song offset.");
    }
  }
  if (value.standalone !== undefined) {
    requireRecord(value.standalone, "standalone preferences");
    requireRecord(value.standalone.settings, "standalone settings");
    if (value.standalone.storage !== undefined) {
      requireRecord(value.standalone.storage, "window preferences");
      if (Object.entries(value.standalone.storage).some(([key, item]) => !key.startsWith("lyssna.") || typeof item !== "string")) throw new Error("Invalid window preferences.");
    }
  }
  if (!Array.isArray(value.lyrics) || value.lyrics.length > 10_000) throw new Error("Invalid local lyrics database (maximum 10,000 songs).");
  const seen = new Set<string>();
  for (const item of value.lyrics) {
    requireRecord(item, "lyric entry");
    if (typeof item.uri !== "string" || item.uri.length > 512 || /[\x00-\x1f]/.test(item.uri)) throw new Error("Invalid lyric track URI.");
    if (item.key !== undefined && (typeof item.key !== "string" || !/^[a-f0-9]{64}$/.test(item.key))) throw new Error("Invalid lyric key.");
    if (!item.uri && !item.key) throw new Error("A lyric entry has no track association.");
    if (!["ttml", "lrc", "json"].includes(String(item.kind)) || typeof item.text !== "string" || new TextEncoder().encode(item.text).length > 2_000_000) throw new Error("Invalid lyric file (maximum 2 MB per song).");
    for (const key of ["name", "artists", "image"]) if (item[key] !== undefined && (typeof item[key] !== "string" || (item[key] as string).length > 4096)) throw new Error("Invalid lyric metadata.");
    const identity = item.uri || String(item.key);
    if (seen.has(identity)) throw new Error("The export contains duplicate lyric tracks.");
    seen.add(identity);
  }
  return value as SettingsTransfer;
}

// Each pair names the same preference in the two storage schemas.
const DIRECT_FIELDS = [
  ["playbackOffset", "lyric_offset_ms"], ["animationFpsCap", "animation_fps_cap"],
  ["animationFpsCapEnabled", "animation_fps_cap_enabled"], ["coverArtAnimation", "cover_animation"],
  ["liquidGlassDialogs", "liquid_glass"], ["motionArtwork", "animated_covers"],
  ["showNpvDynamicBg", "npv_ambience"], ["spaceGravityMode", "space_gravity"],
  ["enableExperimentalWordSync", "experimental_word_sync"], ["rightAlignLyrics", "lyrics_right_align"],
  ["duetLinePadding", "lyrics_wide_duet"], ["creditsFollowLastLine", "lyrics_credits_follow"],
  ["minimalLyricsMode", "lyrics_minimal"], ["lineHoverBackground", "lyrics_line_hover"],
  ["showNoLyricsNotice", "lyrics_no_lyrics_notice"], ["showLyricsCacheActionButton", "lyrics_cache_button"],
  ["scrollLeadEnabled", "lyrics_early_scroll"], ["scrollLeadMs", "lyrics_early_scroll_ms"],
  ["smoothScrolling", "lyrics_smooth_scroll"], ["seekFadeCompensation", "lyrics_seek_compensation"],
  ["showScrollToActiveButton", "lyrics_follow_button"],
  ["releaseYearPosition", "lyrics_year_position"], ["disableNpvLyrics", "lyrics_hide_npv"],
  ["hideNpvLyricsWhenUnavailable", "lyrics_hide_npv_empty"], ["staticBackgroundBlur", "lyrics_background_blur"],
  ["animateFullscreenClose", "fullscreen_animate_close"], ["ignoreMusixmatchWordSync", "lyrics_musixmatch_lines_only"],
  ["prioritizeAppleMusicQuality", "lyrics_prefer_apple"], ["rememberSettingsMenuLocation", "settings_remember_place"],
  ["developerMode", "developer_mode"], ["allowHidingSettings", "settings_allow_hiding"],
  ["discordCreditUsernames", "lyrics_discord_usernames"], ["discordLookupEndpoint", "discord_lookup_url"],
  ["externalCinemaLyricsAllowed", "cinema_lyrics"], ["ttmlMakerMode", "ttml_creator"],
  ["experiment:lyricsSkeleton", "lyrics_skeleton"], ["experiment:canvasImmersive", "canvas_lyrics"],
  ["experiment:newProgressBarStyling", "glass_seek"], ["experiment:keepOverlappingLines", "lyrics_keep_overlaps"],
  ["experiment:romajiAsWritten", "romaji_as_written"],
] as const;
const CHOICES = [
  ["romanizationDisplay", "romanization_below", { underLine: true, replace: false }],
  ["rendererVisualStyle", "lyrics_simple", { bloom: true, spring: false }],
  ["viewControlsPosition", "lyrics_toolbar_bottom", { Top: false, Bottom: true }],
  ["hideHidingIcon", "settings_hide_buttons", { true: false, false: true }],
  ["escapeKeyFunction", "lyrics_escape_exits", { "Exit Fullscreen": false, "Exit Fully": true }],
  ["memeFormat", "lyrics_word_filter", { Off: "off", Gibberish: "gibberish", "all lowercase": "lower", "ALL UPPERCASE": "upper" }],
  ["pinnedFooterMode", "lyrics_pinned_footer", { Off: "off", "No Writers": "no_writers", Full: "full" }],
  ["alwaysShowInFullscreen", "fullscreen_always_show", { None: "none", Controls: "controls", Time: "time", Both: "both" }],
  ["showVolumeSliderFullscreen", "fullscreen_volume", { Off: "off", Left: "left", Right: "right", Below: "below" }],
  ["lyricsCacheAction", "lyrics_cache_action", { "all-current": "song", "current-state": "reload", "stored-cache": "all" }],
  ["staticBackgroundMode", "lyrics_background", { off: "animated", artistHeader: "artist", coverArt: "cover", color: "color", none: "none", legacy: "static", default: "animated", auto: "artist" }],
] as const;

function mapped(input: SettingsRecord, toStandalone: boolean): SettingsRecord {
  const output: SettingsRecord = {};
  for (const [plugin, standalone] of DIRECT_FIELDS) {
    const from = toStandalone ? plugin : standalone;
    if (Object.hasOwn(input, from)) output[toStandalone ? standalone : plugin] = input[from];
  }
  for (const [plugin, standalone, choices] of CHOICES) {
    const value = input[toStandalone ? plugin : standalone];
    const match = Object.entries(choices).find(([key, item]) => toStandalone ? key === String(value) : item === value);
    if (match) output[toStandalone ? standalone : plugin] = toStandalone ? match[1] : plugin === "hideHidingIcon" ? match[0] === "true" : match[0];
  }
  const size = input[toStandalone ? "lyricsSize" : "lyric_size"];
  if (typeof size === "number" && Number.isFinite(size)) output[toStandalone ? "lyric_size" : "lyricsSize"] = toStandalone ? Math.min(72, Math.max(18, size * 36 / 100)) : Math.min(200, Math.max(60, size * 100 / 36));
  for (const [plugin, standalone] of [["lyricsSourceOrder", "lyrics_source_order"], ["disabledLyricsSources", "lyrics_sources_disabled"]]) {
    const value = input[toStandalone ? plugin : standalone];
    if (value === undefined) continue;
    const list: unknown = toStandalone && typeof value === "string" ? JSON.parse(value) : value;
    if (!Array.isArray(list) || list.some(item => typeof item !== "string")) throw new Error("Invalid lyrics source preferences.");
    output[toStandalone ? standalone : plugin] = toStandalone ? list : JSON.stringify(list);
  }
  const animatorFields = [["animatorPreset", "preset"], ["animatorDetail", "detail"], ["animatorCustom", "custom"], ["savedAnimatorPresets", "saved"], ["selectedAnimatorPresetId", "selected"]];
  const animator: SettingsRecord = {};
  for (const [plugin, standalone] of animatorFields) {
    const value = toStandalone ? input[plugin] : isRecord(input.lyrics_animator) ? input.lyrics_animator[standalone] : undefined;
    if (value !== undefined) {
      const converted = standalone !== "preset" ? value : toStandalone ? ({ Pixel: "Lyssna", Default: "Legacy" } as SettingsRecord)[value as string] ?? value : ({ Lyssna: "Pixel", Legacy: "Default" } as SettingsRecord)[value as string] ?? value;
      if (toStandalone) animator[standalone] = converted;
      else output[plugin] = converted;
    }
  }
  if (toStandalone && Object.keys(animator).length) output.lyrics_animator = animator;
  if (toStandalone && typeof input.customFontEnabled === "boolean") output.lyric_font = input.customFontEnabled && typeof input.customFont === "string" ? input.customFont : "";
  if (!toStandalone && typeof input.lyric_font === "string") {
    output.customFont = input.lyric_font;
    output.customFontEnabled = !!input.lyric_font;
  }
  return output;
}

export function pluginPreferences(file: SettingsTransfer): PluginPreferences {
  const own = file.plugin ?? { settings: {}, uiState: {}, songOffsets: {}, enhancements: {}, playlistFolders: [] };
  if (file.source === "plugin" || !file.standalone) return own;
  const standalone = file.standalone.settings;
  const uiState = { ...own.uiState };
  for (const [plugin, key] of [["romanization", "romanized"], ["isNowBarOpen", "now_playing_open"], ["forceCompactMode", "lyrics_compact"]]) if (typeof standalone[key] === "boolean") uiState[plugin] = standalone[key];
  const songOffsets = isRecord(standalone.lyric_song_offsets) ? standalone.lyric_song_offsets as Record<string, number> : own.songOffsets;
  const enhancements = { ...own.enhancements };
  if (isRecord(standalone.spotify_plus) && Array.isArray(standalone.spotify_plus.playlist_folders)) enhancements.playlistOverrideFolderIds = standalone.spotify_plus.playlist_folders;
  return { ...own, settings: { ...own.settings, ...mapped(standalone, false) }, uiState, songOffsets, enhancements };
}

export function standalonePreferences(file: SettingsTransfer): SettingsRecord {
  const own = file.standalone?.settings ?? {};
  if (file.source === "standalone" || !file.plugin) return own;
  const plugin = file.plugin;
  const result = { ...own, ...mapped(plugin.settings, true) };
  for (const [key, standalone] of [["romanization", "romanized"], ["isNowBarOpen", "now_playing_open"], ["forceCompactMode", "lyrics_compact"]]) if (typeof plugin.uiState[key] === "boolean") result[standalone] = plugin.uiState[key];
  result.lyric_song_offsets = plugin.songOffsets;
  if (Array.isArray(plugin.enhancements.playlistOverrideFolderIds)) result.spotify_plus = { playlist_folders: plugin.enhancements.playlistOverrideFolderIds };
  return result;
}

export function mergeLyrics(preserved: TransferLyrics[], current: TransferLyrics[]): TransferLyrics[] {
  const records = new Map(preserved.map(item => [item.uri || item.key!, item]));
  for (const item of current) records.set(item.uri || item.key!, item);
  return [...records.values()];
}
export function downloadTransfer(file: SettingsTransfer, prefix = "lyssna-settings"): void {
  const text = JSON.stringify(file, null, 2);
  parseTransfer(text);
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${prefix}-${new Date().toISOString().replace(/[:.]/g, "-")}.lyssna.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
