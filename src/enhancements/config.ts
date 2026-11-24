import { useSyncExternalStore } from "react";
import { Spicetify, storage } from "./compat";

export const SETTINGS_CHANGED_EVENT = "lyssna-rewrite:enhancements-changed";
const storageKey = "lyssna-lyrics.rewrite-enhancements.v1";
const folderKey = "lyssna-lyrics.rewrite-playlist-folders.v1";

const defaults = {
  enhanceSpotifyPerformance: true,
  hideYourUpdatesSection: true,
  hideHomeConfigMenuItem: true,
  hideAccountMenuItem: true,
  hideProfileMenuItem: false,
  hideRecentsMenuItem: true,
  hideSupportMenuItem: true,
  hidePrivateSessionMenuItem: false,
  hideLogOutMenuItem: false,
  hideFriendActivityButton: true,
  hideLyricsButton: true,
  hideMiniplayerButton: true,
  disablePeek: true,
  restoreOldDevicePicker: true,
  restoreOldShareMenu: true,
  showTrackCopyMenu: true,
  overridePlaylistFolderBehavior: false,
  showPlaylistMenuCoverArt: false,
  playlistOverrideFolderIds: [] as string[],
  playlistBaseFolderId: "",
};

type EnhancementSettings = typeof defaults;
export type EnhancementKey = keyof EnhancementSettings;
export interface PlaylistFolderPlaylistEntry { name: string; uri: string | null }
export interface PlaylistFolderEntry { id: string; label: string; path: string; playlists: PlaylistFolderPlaylistEntry[] }

export function configuredExtensions() {
  const extensions = Spicetify.Config?.extensions;
  return (Array.isArray(extensions) ? extensions : typeof extensions === "string" ? extensions.split("|") : [])
    .filter((name): name is string => typeof name === "string");
}

export function hasStandaloneSpotifyPlus() {
  return configuredExtensions().some((name) => /(?:^|[/\\])spotify-plus\.(?:js|mjs)$/i.test(name.trim()));
}

const legacyFile = /(?:^|[/\\])lyssna-lyrics-legacy\.(?:js|mjs)(?:[?#]|$)/i;

export function hasLegacyLoader() {
  return configuredExtensions().some((name) => legacyFile.test(name.trim())) ||
    Array.from(document.scripts).some((script) => legacyFile.test(script.src));
}

function parse(value: string | null) {
  try { return JSON.parse(value ?? "null"); } catch { return null; }
}

export function enhancementPreferences(saved: Record<string, unknown>) {
  const patch: Partial<EnhancementSettings> = {};
  for (const key of Object.keys(defaults) as EnhancementKey[]) {
    const setting = saved[key];
    const fallback = defaults[key];
    if (Array.isArray(fallback) ? Array.isArray(setting) && setting.every((item) => typeof item === "string") : typeof setting === typeof fallback) {
      (patch as Record<string, unknown>)[key] = setting;
    }
  }
  if (!patch.playlistOverrideFolderIds && patch.playlistBaseFolderId) patch.playlistOverrideFolderIds = [patch.playlistBaseFolderId];
  return patch;
}

export function readSpotifyPlusPreferences(read: (key: string) => Record<string, unknown> | undefined) {
  return enhancementPreferences(Object.fromEntries(Object.keys(defaults).map((key) => [key, read(`spotify-plus-settings.${key}`)?.value])));
}

export function initializeEnhancementPreferences() {
  if (storage.get(storageKey) != null) return;
  const existing = parse(storage.get("LL:enhancements")) ?? {};
  storage.set(storageKey, JSON.stringify(enhancementPreferences(existing)));
}

let lastSaved: string | null | undefined;
let snapshot = defaults;
export function getSettings(): EnhancementSettings {
  const value = storage.get(storageKey);
  if (value === lastSaved) return snapshot;
  lastSaved = value;
  snapshot = { ...defaults, ...enhancementPreferences(parse(value) ?? {}) };
  return snapshot;
}

export function getSetting<Key extends EnhancementKey>(key: Key) {
  return getSettings()[key];
}

export function setSetting<Key extends EnhancementKey>(key: Key, value: EnhancementSettings[Key]) {
  saveEnhancementPreferences({ [key]: value });
}

export function saveEnhancementPreferences(patch: Partial<EnhancementSettings>) {
  const current = getSettings();
  const changed = (Object.keys(patch) as EnhancementKey[]).filter((key) => JSON.stringify(patch[key]) !== JSON.stringify(current[key]));
  if (!changed.length) return;
  const next = JSON.stringify({ ...current, ...patch });
  storage.set(storageKey, next);
  if (storage.get(storageKey) !== next) throw new Error("Enhancement preferences could not be saved.");
  for (const key of changed) window.dispatchEvent(new CustomEvent(SETTINGS_CHANGED_EVENT, { detail: { key } }));
}

export function subscribeSettings(update: () => void) {
  window.addEventListener(SETTINGS_CHANGED_EVENT, update);
  return () => window.removeEventListener(SETTINGS_CHANGED_EVENT, update);
}

const enhanceSpotifyPerformance = () => getSetting("enhanceSpotifyPerformance");

export function useEnhancedPerformance() {
  return useSyncExternalStore(subscribeSettings, enhanceSpotifyPerformance);
}

export function getCachedPlaylistFolders(): PlaylistFolderEntry[] {
  const saved = parse(storage.get(folderKey));
  if (!Array.isArray(saved)) return [];
  return saved.filter((folder) => typeof folder?.id === "string" && typeof folder.label === "string" && typeof folder.path === "string")
    .map((folder) => ({
      id: folder.id, label: folder.label, path: folder.path,
      playlists: Array.isArray(folder.playlists) ? folder.playlists.flatMap((item: unknown) => {
        if (typeof item === "string") return [{ name: item, uri: null }];
        if (item && typeof item === "object" && "name" in item && typeof item.name === "string") {
          return [{ name: item.name, uri: "uri" in item && typeof item.uri === "string" ? item.uri : null }];
        }
        return [];
      }) : [],
    }));
}

export function setCachedPlaylistFolders(folders: PlaylistFolderEntry[]) {
  storage.set(folderKey, JSON.stringify(folders));
  window.dispatchEvent(new CustomEvent(SETTINGS_CHANGED_EVENT, { detail: { key: "playlistOverrideFolderIds" } }));
}
