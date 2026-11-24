import { spicetify, spotikit, type Host } from "../../host";
import { hasSavedLocalTrackMatches, savedLocalTrackIsrc } from "../../local-track-isrc";
import { lyricsChanged } from "../../local-lyrics";
import { localSongTags, spotifySongKey } from "../../spotify-song";
import { normalizeIsrc } from "../../spotify-track-metadata";
import { unavailableTrack } from "./unavailableTrackMenu";

type PlaylistTrack = {
  uri?: string;
  uid?: string;
  name?: string;
  album?: { name?: string };
  artists?: { name?: string }[];
  duration?: { milliseconds?: number };
  metadata?: Record<string, string>;
  isPlayable?: boolean;
  isBanned?: boolean;
  is19PlusOnly?: boolean;
};
type PlaybackTrack = { uri: string; uid?: string; metadata?: Record<string, string> };
type StartAt = { uri?: string; uid?: string; index?: number; pageIndex?: number };
type PlaySource = {
  uri: string;
  url?: string;
  pages?: { items: PlaybackTrack[] }[];
  playlistQueryOptions?: Record<string, unknown>;
};
type PlayOptions = { skipTo?: StartAt; shuffle?: boolean; repeat?: number } & Record<string, unknown>;
type Player = {
  play(source: PlaySource, origin: Record<string, unknown>, options?: PlayOptions): Promise<unknown>;
};
type PlaylistAPI = {
  getContents(uri: string, query: Record<string, unknown>): Promise<{ items: PlaylistTrack[]; totalLength: number }>;
};
type LocalFilesAPI = { getTracks(): Promise<PlaylistTrack[]> };
type Playlist = { tracks: PlaylistTrack[]; replacements: Map<string, PlaybackTrack> };

const playlistUri = /^spotify:playlist:[A-Za-z0-9]{22}$/;
const catalogueUri = /^spotify:track:[A-Za-z0-9]{22}$/;
const playButton = "[data-lyssna-play-local]";
const rowSelector = ".main-trackList-trackListRow, [data-testid='tracklist-row']";

function matchedFiles(tracks: PlaylistTrack[]) {
  const files = new Map<string, PlaybackTrack[]>();
  for (const item of tracks) {
    const uri = item.uri ?? "";
    const tags = localSongTags(uri);
    if (!tags || item.isPlayable === false || item.isBanned || item.is19PlusOnly) continue;
    const title = item.name || tags.title;
    const artist = item.artists?.[0]?.name || tags.artist;
    const album = item.album?.name || tags.album;
    const duration = item.duration?.milliseconds ?? tags.duration;
    const isrc = savedLocalTrackIsrc({ id: uri, local: true, title, artist, artists: artist,
      album, cover: "", isrc: item.metadata?.isrc }, duration);
    if (!isrc) continue;
    const track = { uri, metadata: { is_local: "true", title, artist_name: artist, album_title: album, duration: String(duration) } };
    const copies = files.get(isrc) ?? [];
    if (!copies.some(copy => copy.uri === uri)) copies.push(track);
    files.set(isrc, copies);
  }
  return files;
}

export function startLocalPlaylistPlayback(host: Host) {
  const spice = spicetify();
  const platform = spotikit()?.Platform ?? spice?.Platform;
  const player = (platform?.PlayerAPI ?? spice?.Player?.origin) as Player | undefined;
  const playlists = platform?.PlaylistAPI as PlaylistAPI | undefined;
  const localFiles = platform?.LocalFilesAPI as LocalFilesAPI | undefined;
  if (typeof player?.play !== "function" || !playlists?.getContents || !localFiles?.getTracks) return () => {};
  const nativePlay = player.play;
  const cache = new Map<string, { until: number; promise: Promise<Playlist> }>();
  let generation = 0;
  let active = true;
  let scanFrame = 0;
  let matchRevision = 0;
  const handlers = new AbortController();

  async function prepare(uri: string, query: Record<string, unknown>): Promise<Playlist> {
    const files = matchedFiles(await localFiles!.getTracks());
    const tracks: PlaylistTrack[] = [];
    const replacements = new Map<string, PlaybackTrack>();
    if (!files.size) return { tracks, replacements };
    const limit = 150;
    for (let offset = 0; active;) {
      const page = await playlists!.getContents(uri, { ...query, offset, limit });
      tracks.push(...page.items);
      offset += page.items.length;
      if (!page.items.length || offset >= page.totalLength) break;
    }
    const eligible = [...new Set(tracks.filter(track => track.isPlayable === false && !track.isBanned && !track.is19PlusOnly)
      .map(track => track.uri ?? "").filter(uri => catalogueUri.test(uri)))];
    for (let offset = 0; active && offset < eligible.length; offset += 8) {
      await Promise.all(eligible.slice(offset, offset + 8).map(async trackUri => {
        const id = spotifySongKey(trackUri)!;
        const isrc = normalizeIsrc(await host.lookupIsrc(id).catch(() => undefined));
        const copies = isrc ? files.get(isrc) : undefined;
        if (copies?.length === 1) replacements.set(trackUri, copies[0]);
      }));
    }
    return { tracks, replacements };
  }

  function readPlaylist(uri: string, query: Record<string, unknown> = {}) {
    const key = JSON.stringify([uri, query]);
    const known = cache.get(key);
    if (known && known.until > Date.now()) return known.promise;
    const promise = prepare(uri, query).catch(error => {
      if (cache.get(key)?.promise === promise) cache.delete(key);
      throw error;
    });
    cache.set(key, { until: Date.now() + 20_000, promise });
    if (cache.size > 5) cache.delete(cache.keys().next().value!);
    return promise;
  }

  function adaptedPlayback(playlist: Playlist, skipTo: StartAt | undefined) {
    if (!playlist.replacements.size) return;
    const rows = playlist.tracks.flatMap((track, index) => {
      if (!track.uri) return [];
      const replacement = track.isPlayable === false ? playlist.replacements.get(track.uri) : undefined;
      if ((track.isPlayable === false && !replacement) || track.isBanned || track.is19PlusOnly) return [];
      const item = replacement ? { ...replacement, uid: track.uid } : { uri: track.uri, uid: track.uid };
      return [{ original: track, index, item }];
    });
    const start = skipTo && rows.find(row => skipTo.uid ? row.original.uid === skipTo.uid
      : skipTo.uri ? row.original.uri === skipTo.uri
      : skipTo.index !== undefined && row.index === skipTo.index);
    if (skipTo && !start && (skipTo.uid || skipTo.uri || skipTo.index !== undefined)) return;
    return { items: rows.map(row => row.item), skipTo: start ? { index: rows.indexOf(start) } : undefined };
  }

  function playAdapted(receiver: Player, uri: string, playback: NonNullable<ReturnType<typeof adaptedPlayback>>,
    origin: Record<string, unknown>, options: PlayOptions) {
    const repeat = { off: 0, context: 1, track: 2 }[host.repeat()];
    return nativePlay.call(receiver, {
      uri: `spotify:trackset:Lyssna ${uri.split(":")[2]}`,
      pages: [{ items: playback.items }],
    }, origin, { ...options, skipTo: playback.skipTo, shuffle: options.shuffle ?? host.shuffle(), repeat: options.repeat ?? repeat });
  }

  player.play = async function (this: Player, source, origin, options = {}) {
    const request = ++generation;
    if (active && playlistUri.test(source?.uri ?? "") && !source.pages &&
        (!source.url || source.url === `context://${source.uri}`) && hasSavedLocalTrackMatches()) {
      const playlist = await readPlaylist(source.uri, source.playlistQueryOptions).catch(() => undefined);
      if (!active || request !== generation) return;
      const playback = playlist && adaptedPlayback(playlist, options.skipTo);
      if (playback) {
        try { return await playAdapted(this, source.uri, playback, origin, options); }
        catch (error) {
          if (!active || request !== generation) return;
          console.warn("[Lyssna Lyrics] Could not start the playlist with local files:", error);
        }
      }
    }
    return nativePlay.call(this, source, origin, options);
  };
  const wrappedPlay = player.play;

  function visiblePlaylist() {
    const id = /^\/playlist\/([A-Za-z0-9]{22})(?:[?#]|$)/.exec(host.viewLocation() ?? "")?.[1];
    if (id) return `spotify:playlist:${id}`;
  }
  function rowTarget(element: Element, context: string) {
    const target = unavailableTrack(element);
    if (target && !target.restricted && (!target.contextUri || target.contextUri === context)) return target;
  }
  let shown: { uri: string; data: Playlist } | undefined;
  async function scan() {
    const uri = visiblePlaylist();
    if (!uri || !hasSavedLocalTrackMatches()) return;
    const revision = matchRevision;
    if (!Array.from(document.querySelectorAll(rowSelector)).some(row => rowTarget(row, uri))) {
      document.querySelectorAll(playButton).forEach(button => button.remove());
      return;
    }
    const data = await readPlaylist(uri).catch(() => undefined);
    if (!active || !data || visiblePlaylist() !== uri || matchRevision !== revision) return;
    shown = { uri, data };
    for (const row of document.querySelectorAll(rowSelector)) {
      const target = rowTarget(row, uri);
      const button = row.querySelector<HTMLButtonElement>(playButton);
      if (!target || !data.replacements.has(target.uri)) { button?.remove(); continue; }
      if (button) continue;
      const cell = row.querySelector(".main-trackList-rowSectionIndex");
      if (!cell) continue;
      const control = document.createElement("button");
      control.type = "button";
      control.dataset.lyssnaPlayLocal = "";
      control.title = "Play local file";
      control.setAttribute("aria-label", "Play local file");
      cell.append(control);
    }
  }
  function scheduleScan() {
    if (scanFrame || !visiblePlaylist()) return;
    scanFrame = window.requestAnimationFrame(() => {
      scanFrame = 0;
      void scan();
    });
  }

  function activate(event: MouseEvent | KeyboardEvent) {
    if (!(event.target instanceof Element)) return;
    if (event.type === "click" && !event.target.closest(playButton)) return;
    if (event.type === "dblclick" && event.target.closest("a,button,input")) return;
    if (event instanceof KeyboardEvent && (event.key !== "Enter" || event.target.closest("a,button,input"))) return;
    const uri = visiblePlaylist();
    const target = uri && rowTarget(event.target, uri);
    if (!target || !uri || shown?.uri !== uri || !shown.data.replacements.has(target.uri)) return;
    const row = shown.data.tracks[target.index ?? -1];
    const playback = adaptedPlayback(shown.data, row?.uri === target.uri && row.uid ? { uid: row.uid } : { uri: target.uri });
    if (!playback) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    ++generation;
    void playAdapted(player!, uri, playback, { featureIdentifier: "playlist" }, {})
      .catch(() => { if (active) host.notifyError("Spotify couldn’t play the matched local file."); });
  }

  const observer = new MutationObserver(records => {
    if (records.some(record => (record.target instanceof Element && !!record.target.closest(rowSelector) &&
        (record.type === "attributes" || ![...record.addedNodes, ...record.removedNodes].every(node =>
          node instanceof Element && node.matches(playButton)))) ||
      Array.from(record.addedNodes).some(node =>
        node instanceof Element && (node.matches(rowSelector) || node.querySelector(rowSelector))))) scheduleScan();
  });
  observer.observe(document.body, {
    childList: true, subtree: true, attributes: true, attributeFilter: ["aria-disabled", "aria-rowindex", "data-uri"],
  });
  function matchesChanged() {
    matchRevision++;
    cache.clear();
    shown = undefined;
    document.querySelectorAll(playButton).forEach(button => button.remove());
    scheduleScan();
  }
  window.addEventListener(lyricsChanged, matchesChanged, { signal: handlers.signal });
  for (const event of ["click", "dblclick", "keydown"] as const) {
    document.addEventListener(event, activate, { capture: true, signal: handlers.signal });
  }
  scheduleScan();
  return () => {
    active = false;
    handlers.abort();
    observer.disconnect();
    cancelAnimationFrame(scanFrame);
    document.querySelectorAll(playButton).forEach(button => button.remove());
    if (player.play === wrappedPlay) player.play = nativePlay;
  };
}
