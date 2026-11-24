import { spicetify, spotikit, type Host } from "../../host";
import { hasSavedLocalTrackMatches, savedLocalTrackIsrc } from "../../local-track-isrc";
import { lyricsChanged } from "../../local-lyrics";
import { localSongTags, spotifySongKey } from "../../spotify-song";
import { normalizeIsrc } from "../../spotify-track-metadata";
import { readTrackRow, spotifyProps, trackRowSelector } from "./unavailableTrackMenu";

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
  _state?: { item?: StartAt } | null;
  play(source: PlaySource, origin: Record<string, unknown>, options?: PlayOptions): Promise<unknown>;
};
type PlaylistAPI = {
  getContents(uri: string, query: Record<string, unknown>): Promise<{ items: PlaylistTrack[]; totalLength: number }>;
};
type LocalFilesAPI = { getTracks(): Promise<PlaylistTrack[]> };
type Playlist = { tracks: PlaylistTrack[]; replacements: Map<string, PlaybackTrack> };

const playlistUri = /^spotify:playlist:[A-Za-z0-9]{22}$/;
const catalogueUri = /^spotify:track:[A-Za-z0-9]{22}$/;
const matchedRow = "[data-lyssna-local-match]";
const playButton = "[data-lyssna-play-local]";
const activeRow = "[data-lyssna-playlist-current]";
const playlistButton = '[data-testid="action-bar-row"] button[data-encore-id="buttonPrimary"]';
const playlistButtonState = "data-lyssna-playlist-playback";
const tracksetPrefix = "spotify:trackset:Lyssna ";

function playlistQuery(row?: Element) {
  if (!row) return {};
  for (const { sortState } of spotifyProps(row, 42)) {
    const sort = sortState as { column?: string; order?: number | string } | undefined;
    if (sort?.column && [1, 2, "ASC", "DESC"].includes(sort.order ?? "")) {
      return { sort: { field: sort.column, order: sort.order === 2 || sort.order === "DESC" ? "DESC" : "ASC" } };
    }
  }
  return {};
}

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
  let lastPlayback = "";
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
    const start = skipTo && rows.findIndex(row => skipTo.uid ? row.original.uid === skipTo.uid
      : skipTo.uri ? row.original.uri === skipTo.uri
      : skipTo.index !== undefined && row.index === skipTo.index);
    if (start === -1 && (skipTo?.uid || skipTo?.uri || skipTo?.index !== undefined)) return;
    const selected = start !== undefined && start >= 0 ? rows[start].item : undefined;
    return {
      items: rows.map(row => row.item),
      skipTo: selected ? { uri: selected.uri, uid: selected.uid } : undefined,
    };
  }

  function playAdapted(receiver: Player, uri: string, playback: NonNullable<ReturnType<typeof adaptedPlayback>>,
    origin: Record<string, unknown>, options: PlayOptions) {
    const repeat = { off: 0, context: 1, track: 2 }[host.repeat()];
    return nativePlay.call(receiver, {
      // A playlist URI can reload Spotify's original tracks and drop local substitutions.
      uri: `${tracksetPrefix}${uri.split(":")[2]}`,
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
          const local = playback.skipTo?.uri;
          if (local && localSongTags(local)) return host.playTrack(local);
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
    const target = readTrackRow(element);
    if (target?.unavailable && !target.restricted && (!target.contextUri || target.contextUri === context)) return target;
  }
  const labels = new Map<HTMLButtonElement, { original: string | null; written?: string }>();
  function clearActivePlaylist(buttonToKeep?: HTMLButtonElement) {
    for (const [button, label] of labels) {
      if (button === buttonToKeep) continue;
      button.removeAttribute(playlistButtonState);
      if (button.getAttribute("aria-label") === label.written) {
        if (label.original === null) button.removeAttribute("aria-label");
        else button.setAttribute("aria-label", label.original);
      }
      labels.delete(button);
    }
  }

  function syncActivePlaylist(uri?: string, data?: Playlist) {
    const adapted = !!uri && host.playbackContextUri() === `${tracksetPrefix}${uri.split(":")[2]}`;
    const playing = adapted && host.playing();
    const button = adapted ? host.mainView()?.querySelector<HTMLButtonElement>(playlistButton) : null;
    const props = button && Array.from(spotifyProps(button)).find(props => props.uri === uri);
    clearActivePlaylist(button && props ? button : undefined);
    if (button && props) {
      const currentLabel = button.getAttribute("aria-label");
      const labelsBefore = labels.get(button);
      const savedLabel = labelsBefore?.written === currentLabel ? labelsBefore! : { original: currentLabel };
      labels.set(button, savedLabel);
      const state = playing ? "playing" : "paused";
      if (button.getAttribute(playlistButtonState) !== state) button.setAttribute(playlistButtonState, state);
      const label = playing ? props.ariaPauseLabel : props.ariaPlayLabel;
      if (typeof label === "string" && currentLabel !== label) {
        button.setAttribute("aria-label", label);
        savedLabel.written = label;
      }
    }

    const current = adapted ? player!._state?.item : undefined;
    const original = current?.uid && data?.tracks.find(track => track.uid === current.uid);
    const uriInPlaylist = original ? original.uri : current?.uri;
    const matchingRows = uriInPlaylist && Array.from(document.querySelectorAll(trackRowSelector))
      .map(readTrackRow).filter(row => row?.uri === uriInPlaylist && (!row.contextUri || row.contextUri === uri));
    const selected = matchingRows ? matchingRows.find(row => {
      const source = row?.index === undefined ? undefined : data?.tracks[row.index];
      return source && source.uid === current?.uid && source.uri === uriInPlaylist;
    }) ?? (matchingRows.length === 1 ? matchingRows[0] : undefined) : undefined;
    for (const row of document.querySelectorAll(activeRow)) {
      if (row !== selected?.row) row.removeAttribute("data-lyssna-playlist-current");
    }
    const state = playing ? "playing" : "paused";
    if (selected && selected.row.getAttribute("data-lyssna-playlist-current") !== state) {
      selected.row.setAttribute("data-lyssna-playlist-current", state);
    }
  }
  let shown: { uri: string; data: Playlist } | undefined;
  function clearMatchedRows() {
    for (const row of document.querySelectorAll(matchedRow)) {
      row.removeAttribute("data-lyssna-local-match");
      row.querySelector(playButton)?.remove();
    }
  }

  async function scan() {
    const uri = visiblePlaylist();
    if (shown?.uri !== uri) {
      shown = undefined;
      clearMatchedRows();
    }
    syncActivePlaylist(uri, shown?.data);
    if (!uri || !hasSavedLocalTrackMatches()) return;
    const revision = matchRevision;
    const rows = Array.from(document.querySelectorAll(trackRowSelector));
    let hasUnavailableRows = false;
    for (const row of rows) {
      const target = rowTarget(row, uri);
      hasUnavailableRows ||= !!target;
      if (!target || !shown?.data.replacements.has(target.uri)) {
        row.removeAttribute("data-lyssna-local-match");
        row.querySelector(playButton)?.remove();
      }
    }
    const adapted = host.playbackContextUri() === `${tracksetPrefix}${uri.split(":")[2]}`;
    if (!hasUnavailableRows && (!adapted || shown)) return;
    const data = await readPlaylist(uri, playlistQuery(rows[0])).catch(() => undefined);
    if (!active || !data || visiblePlaylist() !== uri || matchRevision !== revision) return;
    shown = { uri, data };
    syncActivePlaylist(uri, data);
    for (const row of document.querySelectorAll(trackRowSelector)) {
      const target = rowTarget(row, uri);
      const button = row.querySelector<HTMLButtonElement>(playButton);
      if (!target || !data.replacements.has(target.uri)) {
        row.removeAttribute("data-lyssna-local-match");
        button?.remove();
        continue;
      }
      row.setAttribute("data-lyssna-local-match", "");
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
    if (scanFrame || (!shown && !labels.size && !visiblePlaylist())) return;
    scanFrame = window.requestAnimationFrame(() => {
      scanFrame = 0;
      void scan();
    });
  }

  function activate(event: MouseEvent | KeyboardEvent) {
    if (!(event.target instanceof Element)) return;
    if (event.type === "click" && event.target.closest(`[${playlistButtonState}]`)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      host.toggle();
      return;
    }
    if (event.type === "click" && !event.target.closest(playButton)) return;
    if (event.type === "dblclick" && event.target.closest("a,button,input")) return;
    if (event instanceof KeyboardEvent && (event.key !== "Enter" || event.target.closest("a,button,input"))) return;
    const uri = visiblePlaylist();
    const target = uri && rowTarget(event.target, uri);
    if (!target || !uri || shown?.uri !== uri || !shown.data.replacements.has(target.uri)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (target.row.matches(activeRow)) {
      host.toggle();
      return;
    }
    const request = ++generation;
    void readPlaylist(uri, playlistQuery(target.row)).then(data => {
      if (!active || request !== generation) return;
      const row = data.tracks[target.index ?? -1];
      const playback = adaptedPlayback(data, row?.uri === target.uri && row.uid ? { uid: row.uid } : { uri: target.uri });
      if (!playback?.skipTo?.uri || !localSongTags(playback.skipTo.uri)) throw new Error("Local match is unavailable.");
      return playAdapted(player!, uri, playback, { featureIdentifier: "playlist" }, {});
    })
      .catch(() => {
        if (active && request === generation) host.notifyError("Spotify couldn’t play the matched local file.");
      });
  }

  const observer = new MutationObserver(records => {
    if (records.some(record => (record.target instanceof Element && !!record.target.closest(trackRowSelector) &&
        (record.type === "attributes" || ![...record.addedNodes, ...record.removedNodes].every(node =>
          node instanceof Element && node.matches(playButton)))) ||
      Array.from(record.addedNodes).some(node =>
        node instanceof Element && (node.matches(`${trackRowSelector}, ${playlistButton}`) ||
          node.querySelector(`${trackRowSelector}, ${playlistButton}`))))) scheduleScan();
  });
  observer.observe(document.body, {
    childList: true, subtree: true, attributes: true, attributeFilter: ["aria-disabled", "aria-rowindex", "data-uri"],
  });
  function matchesChanged() {
    matchRevision++;
    cache.clear();
    shown = undefined;
    clearMatchedRows();
    scheduleScan();
  }
  window.addEventListener(lyricsChanged, matchesChanged, { signal: handlers.signal });
  for (const event of ["click", "dblclick", "keydown"] as const) {
    document.addEventListener(event, activate, { capture: true, signal: handlers.signal });
  }
  const stopWatchingPlayback = host.watchControls(() => {
    const current = player._state?.item;
    const key = JSON.stringify([host.playbackContextUri(), current?.uri, current?.uid, host.playing()]);
    if (key === lastPlayback) return;
    lastPlayback = key;
    scheduleScan();
  });
  const stopWatchingRoute = host.watchViewSwitch(source => { if (source === "route") scheduleScan(); });
  scheduleScan();
  return () => {
    active = false;
    handlers.abort();
    observer.disconnect();
    stopWatchingPlayback();
    stopWatchingRoute();
    cancelAnimationFrame(scanFrame);
    clearMatchedRows();
    syncActivePlaylist();
    if (player.play === wrappedPlay) player.play = nativePlay;
  };
}
