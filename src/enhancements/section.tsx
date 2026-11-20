import { useState, useSyncExternalStore } from "react";
import { getSettings, getCachedPlaylistFolders, setSetting, subscribeSettings, type EnhancementKey, type PlaylistFolderEntry } from "./config";
import { refreshPlaylistFolderCache } from "./playlistFolders";
import { SettingRow, Toggle } from "../lyssna/setting-row";
import { externalEnhancementOwner } from "./index";

type ToggleDefinition = { key: EnhancementKey; label: string; description?: string };
const groups: { title: string; settings: ToggleDefinition[] }[] = [
  { title: "Profile menu", settings: [
    { key: "hideYourUpdatesSection", label: 'Hide “Your Updates”' },
    { key: "hideHomeConfigMenuItem", label: "Hide Home Config" },
    { key: "hideAccountMenuItem", label: "Hide Account" },
    { key: "hideProfileMenuItem", label: "Hide Profile" },
    { key: "hideRecentsMenuItem", label: "Hide Recents" },
    { key: "hideSupportMenuItem", label: "Hide Support" },
    { key: "hidePrivateSessionMenuItem", label: "Hide Private Session" },
    { key: "hideLogOutMenuItem", label: "Hide Log Out" },
  ] },
  { title: "Spotify interface", settings: [
    { key: "hideFriendActivityButton", label: "Hide Friend Activity button" },
    { key: "hideLyricsButton", label: "Hide Spotify lyrics button", description: "Keeps the Lyssna Lyrics button available." },
    { key: "hideMiniplayerButton", label: "Hide Miniplayer button" },
    { key: "disablePeek", label: "Disable Peek", description: "Use a regular Now Playing panel instead of Spotify’s floating preview." },
    { key: "restoreOldDevicePicker", label: "Classic device picker", description: "Show devices in a compact popover instead of the sidebar." },
    { key: "restoreOldShareMenu", label: "Classic share menu", description: "Restore direct copy-link and embed actions." },
  ] },
  { title: "Playlists", settings: [
    { key: "overridePlaylistFolderBehavior", label: "Choose playlist folders", description: "Replace Add to playlist folders with the folders you choose below." },
    { key: "showPlaylistMenuCoverArt", label: "Playlist cover art", description: "Show covers in the Add to playlist menu." },
  ] },
];

export default function EnhancementsSection({ notice }: { notice: (message: string) => void }) {
  const settings = useSyncExternalStore(subscribeSettings, getSettings);
  const [folders, setFolders] = useState<PlaylistFolderEntry[]>(getCachedPlaylistFolders);
  const [scanning, setScanning] = useState(false);
  const owner = externalEnhancementOwner();
  function change<Key extends EnhancementKey>(key: Key, value: ReturnType<typeof getSettings>[Key]) {
    setSetting(key, value);
  }
  const scan = async () => {
    if (scanning) return;
    setScanning(true);
    try {
      const found = await refreshPlaylistFolderCache();
      setFolders(found);
      if (!found.length) notice("No playlist folders found.");
    } catch { notice("Could not load playlist folders. Try again."); }
    finally { setScanning(false); }
  };
  return <>
    {owner && <SettingRow label={`${owner} controls enhancements`} help="Changes here apply when this plugin controls Spotify’s interface." />}
    {groups.map(group => {
      const playlistGroup = group.title === "Playlists";
      return <section className="lyrics-settings-section" key={group.title}>
        <h3>{group.title}</h3><div className="lyrics-settings-group">
        {group.settings.map(setting => <SettingRow key={setting.key} label={setting.label} help={setting.description}>
          <Toggle label={setting.label} checked={settings[setting.key] === true} onChange={value => change(setting.key, value)} />
        </SettingRow>)}
        {playlistGroup && <>
          <SettingRow label="Playlist folders" help="Scan your library for folders to use in Add to playlist.">
            <button className="pill outline" type="button" disabled={scanning} onClick={() => void scan()}>{scanning ? "Scanning…" : "Refresh folders"}</button>
          </SettingRow>
          {settings.overridePlaylistFolderBehavior && (folders.length
            ? folders.slice().sort((a, b) => a.path.localeCompare(b.path)).map(folder => <SettingRow key={folder.id} label={folder.path || folder.label}>
              <Toggle label={folder.path || folder.label} checked={settings.playlistOverrideFolderIds.includes(folder.id)} onChange={enabled => {
                const selected = new Set(settings.playlistOverrideFolderIds);
                if (enabled) selected.add(folder.id); else selected.delete(folder.id);
                change("playlistOverrideFolderIds", [...selected]);
              }} />
            </SettingRow>)
            : <SettingRow label="No folders cached" help="Refresh folders to choose which ones appear in Add to playlist." />)}
        </>}
      </div></section>;
    })}
  </>;
}
