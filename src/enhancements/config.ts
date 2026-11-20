import { Spicetify, storage } from "./compat";

export const SETTINGS_CHANGED_EVENT = "lyssna-lyrics:enhancements-changed";
const storageKey = "LL:enhancements";
const folderKey = "LL:enhancement-playlist-folders";
const spotifyPlusEvent = "spotify-plus:settings-changed";

const defaults = {
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

function parse(value: string | null) {
  try { return JSON.parse(value ?? "null"); } catch { return null; }
}

let lastSaved: string | null | undefined;
let snapshot = defaults;
export function getSettings(): EnhancementSettings {
  const value = storage.get(storageKey);
  if (value === lastSaved) return snapshot;
  const saved = parse(value);
  const next = { ...defaults };
  for (const key of Object.keys(defaults) as EnhancementKey[]) {
    const setting = saved?.[key] ?? parse(storage.get(`spotify-plus-settings.${key}`))?.value;
    const fallback = defaults[key];
    if (Array.isArray(fallback) ? Array.isArray(setting) && setting.every((item) => typeof item === "string") : typeof setting === typeof fallback) {
      (next as Record<EnhancementKey, unknown>)[key] = setting;
    }
  }
  if (!next.playlistOverrideFolderIds.length && next.playlistBaseFolderId && !Array.isArray(saved?.playlistOverrideFolderIds)) {
    next.playlistOverrideFolderIds = [next.playlistBaseFolderId];
  }
  lastSaved = value;
  snapshot = next;
  return snapshot;
}

export function getSetting<Key extends EnhancementKey>(key: Key) {
  return getSettings()[key];
}

export function setSetting<Key extends EnhancementKey>(key: Key, value: EnhancementSettings[Key]) {
  storage.set(storageKey, JSON.stringify({ ...getSettings(), [key]: value }));
  if (hasStandaloneSpotifyPlus()) {
    storage.set(`spotify-plus-settings.${key}`, JSON.stringify({ value }));
    window.dispatchEvent(new CustomEvent(spotifyPlusEvent, { detail: { key, value } }));
  }
  window.dispatchEvent(new CustomEvent(SETTINGS_CHANGED_EVENT, { detail: { key } }));
}

export function subscribeSettings(update: () => void) {
  window.addEventListener(SETTINGS_CHANGED_EVENT, update);
  return () => window.removeEventListener(SETTINGS_CHANGED_EVENT, update);
}

export function getCachedPlaylistFolders(): PlaylistFolderEntry[] {
  const saved = parse(storage.get(folderKey)) ?? parse(storage.get("spotify-plus.playlist-folders"))?.value;
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
  if (hasStandaloneSpotifyPlus()) {
    storage.set("spotify-plus.playlist-folders", JSON.stringify({ value: folders }));
    window.dispatchEvent(new CustomEvent(spotifyPlusEvent, { detail: {
      key: "playlistOverrideFolderIds", value: getSetting("playlistOverrideFolderIds"),
    } }));
  }
  window.dispatchEvent(new CustomEvent(SETTINGS_CHANGED_EVENT, { detail: { key: "playlistOverrideFolderIds" } }));
}
