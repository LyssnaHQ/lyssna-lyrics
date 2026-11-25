import { useContext, useId, useState, useSyncExternalStore } from "react";
import { getSettings, getCachedPlaylistFolders, setSetting, subscribeSettings, type EnhancementKey, type PlaylistFolderEntry } from "./config";
import { refreshPlaylistFolderCache } from "./playlistFolders";
import { matchesSetting, SettingRow, SettingsQuery, SettingsSection, Toggle } from "../lyssna/setting-row";
import { externalEnhancementOwner } from "./index";

type ToggleDefinition = { key: EnhancementKey; label: string; description?: string };
const groups: { title: string; columns?: boolean; hide?: boolean; settings: ToggleDefinition[] }[] = [
  { title: "Performance", settings: [
    { key: "enhanceSpotifyPerformance", label: "Enhance Spotify Performance", description: "Keep volume drags responsive, group Spotify interface updates, and reduce Creator redraws during lyrics previews." },
  ] },
  { title: "Hide from profile menu", columns: true, hide: true, settings: [
    { key: "hideYourUpdatesSection", label: "Your Updates" },
    { key: "hideHomeConfigMenuItem", label: "Home Config" },
    { key: "hideAccountMenuItem", label: "Account" },
    { key: "hideProfileMenuItem", label: "Profile" },
    { key: "hideRecentsMenuItem", label: "Recents" },
    { key: "hideSupportMenuItem", label: "Support" },
    { key: "hidePrivateSessionMenuItem", label: "Private Session" },
    { key: "hideLogOutMenuItem", label: "Log Out" },
  ] },
  { title: "Spotify buttons and panels", columns: true, settings: [
    { key: "hideFriendActivityButton", label: "Hide Friend Activity button" },
    { key: "hideLyricsButton", label: "Hide Spotify lyrics button", description: "Keeps the Lyssna Lyrics button available." },
    { key: "hideMiniplayerButton", label: "Hide Miniplayer button" },
    { key: "disablePeek", label: "Disable Peek", description: "Use a regular Now Playing panel instead of Spotify’s floating preview." },
  ] },
  { title: "Devices and sharing", columns: true, settings: [
    { key: "restoreOldDevicePicker", label: "Classic device picker", description: "Show devices in a compact popover instead of the sidebar." },
    { key: "restoreOldShareMenu", label: "Refined share menu", description: "Replace Share with Copy Clean URL and Embed." },
    { key: "showTrackCopyMenu", label: "Track copy menu", description: "Add a Copy submenu beside the share actions for the Spotify ID, song and artist names, and ISRC." },
  ] },
];

export default function EnhancementsSection({ notice }: { notice: (message: string) => void }) {
  const settings = useSyncExternalStore(subscribeSettings, getSettings);
  const [folders, setFolders] = useState<PlaylistFolderEntry[]>(getCachedPlaylistFolders);
  const [scanning, setScanning] = useState(false);
  const [foldersOpen, setFoldersOpen] = useState(false);
  const folderPanelId = useId();
  const query = useContext(SettingsQuery).trim();
  const folderKeywords = "Spotify Tweaks playlists playlist folders add to playlist scan refresh library";
  const folderNames = folders.map(folder => folder.path || folder.label);
  const visibleFolders = folders.filter(folder => matchesSetting(query, folderKeywords, folder.path || folder.label))
    .sort((a, b) => (a.path || a.label).localeCompare(b.path || b.label));
  const showFolders = foldersOpen && (matchesSetting(query, folderKeywords) || visibleFolders.length > 0);
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
    {owner && <SettingRow label={`${owner} controls Spotify tweaks`} help="Changes here apply when this plugin controls Spotify’s interface." />}
    {groups.map(group => <SettingsSection key={group.title} category="Spotify Tweaks" title={group.title} columns={group.columns}>
      {group.settings.map(setting => {
        const label = group.hide ? `Hide ${setting.label}` : setting.label;
        return <SettingRow key={setting.key} label={setting.label} help={setting.description} keywords={`${label} ${group.title}`}>
          <Toggle label={label} checked={settings[setting.key] === true} onChange={value => change(setting.key, value)} />
        </SettingRow>;
      })}
    </SettingsSection>)}
    <SettingsSection category="Spotify Tweaks" title="Playlists">
      <SettingRow label="Custom playlist folders" help="Choose which folders appear in Add to playlist." keywords={folderKeywords}>
        <Toggle label="Custom playlist folders" checked={settings.overridePlaylistFolderBehavior}
          onChange={value => change("overridePlaylistFolderBehavior", value)} />
      </SettingRow>
      <SettingRow label="Playlist folders" help={`${settings.playlistOverrideFolderIds.length} selected`}
        keywords={`${folderKeywords} ${folderNames.join(" ")}`}>
        <button className="pill outline" type="button" aria-expanded={showFolders} aria-controls={showFolders ? folderPanelId : undefined}
          onClick={() => setFoldersOpen(!foldersOpen)}>{showFolders ? "Close folders" : "Choose folders"}</button>
      </SettingRow>
      {showFolders && <div className="settings-folder-list" id={folderPanelId}>
        <div className="lyrics-settings-group" role="group" aria-label="Choose playlist folders">
          <SettingRow label="Refresh folders" keywords={`${folderKeywords} ${folderNames.join(" ")}`}>
            <button className="pill outline" type="button" disabled={scanning} onClick={() => void scan()}>{scanning ? "Scanning…" : "Scan library"}</button>
          </SettingRow>
          {visibleFolders.map(folder => <SettingRow key={folder.id} label={folder.path || folder.label} keywords={folderKeywords}>
            <Toggle label={folder.path || folder.label} checked={settings.playlistOverrideFolderIds.includes(folder.id)} onChange={enabled => {
              const selected = new Set(settings.playlistOverrideFolderIds);
              if (enabled) selected.add(folder.id); else selected.delete(folder.id);
              change("playlistOverrideFolderIds", [...selected]);
            }} />
          </SettingRow>)}
          {!folders.length && <SettingRow label="No folders cached" help="Scan your library to find playlist folders." keywords={folderKeywords} />}
        </div>
      </div>}
      <SettingRow label="Playlist cover art" help="Show covers in the Add to playlist menu.">
        <Toggle label="Playlist cover art" checked={settings.showPlaylistMenuCoverArt} onChange={value => change("showPlaylistMenuCoverArt", value)} />
      </SettingRow>
    </SettingsSection>
  </>;
}
