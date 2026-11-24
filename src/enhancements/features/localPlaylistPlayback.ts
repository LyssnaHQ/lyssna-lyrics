import { spicetify, spotikit, type Host, type Track } from "../../host";
import { lyricsChanged } from "../../local-lyrics";
import { confirmedLocalTrackIsrc, recordingName } from "../../local-track-isrc";
import { localSongTags, spotifySongKey } from "../../spotify-song";
import { normalizeIsrc } from "../../spotify-track-metadata";
import { rowProps, rowSelector, spotifyTrackRow } from "./unavailableTrackMenu";

type PlaylistItem = {
  uri: string;
  uid?: string;
  name?: string;
  album?: { name?: string };
  artists?: { name: string }[];
  duration?: { milliseconds?: number };
  isPlayable?: boolean;
  isBanned?: boolean;
  is19PlusOnly?: boolean;
  metadata?: Record<string, string>;
};
type PlaybackItem = Pick<PlaylistItem, "uri" | "uid" | "metadata">;
type Player = {
  _state?: { item?: PlaybackItem };
  play(
    source: { uri: string; pages: { items: PlaybackItem[] }[] },
    origin: { featureIdentifier: string; viewURI: string },
    options: { skipTo: { uri: string; uid?: string; index: number }; shuffle: boolean; repeat: number },
  ): Promise<unknown>;
};
type PlaylistApi = {
  getContents(uri: string, query: Record<string, unknown>): Promise<{ items: PlaylistItem[]; totalLength: number }>;
};
type LocalFile = { uri: string; isrc: string; name: string; artist: string; duration: number; metadata: Record<string, string> };
type PlaylistRow = NonNullable<ReturnType<typeof spotifyTrackRow>>;
type Selection = { tracks: PlaylistItem[]; replacements: Map<PlaylistItem, LocalFile> };
type Session = { uri: string; playlist: string; originalByUid: Map<string, PlaylistItem>; selection: Selection };

const track = /^spotify:track:[A-Za-z0-9]{22}$/;
const control = "[data-lyssna-local-play]";
const rowAccent = "data-lyssna-current-local-playlist-row";
const headerAccent = "data-lyssna-local-playlist-playing";
const headerButton = '[data-testid="action-bar-row"] button[data-encore-id="buttonPrimary"]';
const libraryRow = ".main-yourLibraryX-listItem";
const libraryAccent = "data-lyssna-library-playlist-playing";
const librarySpeaker = "data-lyssna-library-speaker";
const playlistContext = /^spotify:trackset:Lyssna ([A-Za-z0-9]{22}) [\da-f-]{36}$/;

function viewQuery(view: HTMLElement, rows: PlaylistRow[]) {
  const filter = view.querySelector<HTMLInputElement>(".x-filterBox-filterInput")?.value.trim() || undefined;
  const sort = rows[0] && Array.from(rowProps(rows[0].row, 42))
    .find(props => props.sortState)?.sortState as { column?: string; order?: number } | undefined;
  return {
    filter,
    sort: sort?.column && (sort.order === 1 || sort.order === 2)
      ? { field: sort.column, order: sort.order === 2 ? "DESC" : "ASC" }
      : undefined,
  };
}

function rowItem(row: PlaylistRow, items: PlaylistItem[]) {
  const indexed = row.index === undefined ? undefined : items[row.index];
  if (indexed?.uri === row.uri) return indexed;
  const matches = items.filter(item => item.uri === row.uri);
  if (matches.length === 1) return matches[0];
}

function localFiles(tracks: PlaylistItem[]): LocalFile[] {
  return tracks.flatMap(item => {
    const tags = localSongTags(item.uri);
    if (!tags || item.isPlayable === false || item.isBanned || item.is19PlusOnly) return [];
    const name = item.name || tags.title;
    const artist = item.artists?.[0]?.name || tags.artist;
    const duration = item.duration?.milliseconds || tags.duration;
    const song: Track = { id: item.uri, local: true, title: name, artist, artists: artist,
      album: item.album?.name || tags.album, cover: "", isrc: item.metadata?.isrc };
    const isrc = confirmedLocalTrackIsrc(song, duration);
    if (!isrc) return [];
    return [{ uri: item.uri, name, artist, duration, isrc,
      metadata: { ...item.metadata, is_local: "true", title: name, artist_name: artist, album_title: tags.album, duration: String(duration) } }];
  });
}

export function startLocalPlaylistPlayback(host: Host) {
  const spice = spicetify();
  const platform = spotikit()?.Platform ?? spice?.Platform;
  const player = (platform?.PlayerAPI ?? spice?.Player?.origin) as Player | undefined;
  const playlists = platform?.PlaylistAPI as PlaylistApi | undefined;
  const files = platform?.LocalFilesAPI as { getTracks(): Promise<PlaylistItem[]> } | undefined;
  if (!player?.play || !playlists?.getContents || !files?.getTracks) return () => {};

  const listeners = new AbortController();
  const cache = new Map<string, { expires: number; pending: Promise<Selection> }>();
  let context: { key: string; uri: string; data: Selection; expires: number } | undefined;
  let session: Session | undefined;
  let revision = 0;
  let starting = false;
  let frame = 0;
  let playbackState = "";
  let header: { button: HTMLButtonElement; label: string | null; written?: string } | undefined;
  let libraryTile: HTMLElement | undefined;

  function playlistUri() {
    const id = /^\/playlist\/([A-Za-z0-9]{22})(?:[?#]|$)/.exec(host.viewLocation() ?? "")?.[1];
    return id && `spotify:playlist:${id}`;
  }

  function readRows(view: HTMLElement, playlist: string) {
    return Array.from(view.querySelectorAll<HTMLElement>(rowSelector)).flatMap(element => {
      const row = spotifyTrackRow(element);
      return row && row.context === playlist ? [row] : [];
    });
  }

  async function load(uri: string, query: ReturnType<typeof viewQuery>): Promise<Selection> {
    const library = localFiles(await files!.getTracks());
    const tracks: PlaylistItem[] = [];
    const replacements = new Map<PlaylistItem, LocalFile>();
    if (!library.length) return { tracks, replacements };
    while (!listeners.signal.aborted) {
      const page = await playlists!.getContents(uri, { ...query, offset: tracks.length, limit: 150 });
      tracks.push(...page.items);
      if (!page.items.length || tracks.length >= page.totalLength) break;
    }

    const byName = new Map<string, LocalFile[]>();
    for (const file of library) {
      const name = recordingName(file.name);
      const sameName = byName.get(name);
      if (sameName) sameName.push(file);
      else byName.set(name, [file]);
    }
    const candidates = tracks.filter(item => item.isPlayable === false && !item.isBanned && !item.is19PlusOnly &&
      track.test(item.uri) && byName.has(recordingName(item.name)));
    const codes = new Map<string, Promise<string | undefined>>();
    for (let index = 0; index < candidates.length && !listeners.signal.aborted; index += 4) {
      await Promise.all(candidates.slice(index, index + 4).map(async item => {
        const matches = byName.get(recordingName(item.name))!.filter(file =>
          item.artists?.some(artist => recordingName(artist.name) === recordingName(file.artist)) &&
          file.duration > 0 && item.duration?.milliseconds &&
          Math.abs(item.duration.milliseconds - file.duration) <= 2_000);
        if (!matches.length) return;
        const id = spotifySongKey(item.uri)!;
        let lookup = codes.get(id);
        if (!lookup) {
          lookup = host.lookupIsrc(id, item.metadata?.isrc).catch(() => undefined);
          codes.set(id, lookup);
        }
        const isrc = normalizeIsrc(await lookup);
        const exact = matches.filter(file => file.isrc === isrc);
        if (exact.length === 1) replacements.set(item, exact[0]);
      }));
    }
    return { tracks, replacements };
  }

  function read(uri: string, query: ReturnType<typeof viewQuery>, key: string) {
    const cached = cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.pending;
    const pending = load(uri, query).catch(error => {
      if (cache.get(key)?.pending === pending) cache.delete(key);
      throw error;
    });
    cache.set(key, { expires: Date.now() + 30_000, pending });
    if (cache.size > 4) cache.delete(cache.keys().next().value!);
    return pending;
  }

  function clearHeader() {
    if (!header) return;
    const { button, label, written } = header;
    button.removeAttribute(headerAccent);
    if (button.getAttribute("aria-label") === written) {
      if (label === null) button.removeAttribute("aria-label");
      else button.setAttribute("aria-label", label);
    }
    header = undefined;
  }

  function activeSession() {
    return session && host.playbackContextUri() === session.uri ? session : undefined;
  }

  function activePlaylist() {
    const id = playlistContext.exec(host.playbackContextUri() ?? "")?.[1];
    return activeSession()?.playlist ?? (id ? `spotify:playlist:${id}` : undefined);
  }

  function paintLibrary(playlist?: string) {
    const title = playlist && document.getElementById(`listrow-title-${playlist}`);
    const tile = title ? title.closest<HTMLElement>('[data-encore-id="listRow"]') : null;
    const next = tile?.closest(libraryRow) ? tile : undefined;
    if (libraryTile !== next) {
      libraryTile?.removeAttribute(libraryAccent);
      libraryTile?.querySelector(`[${librarySpeaker}]`)?.remove();
      libraryTile = next;
    }
    if (!libraryTile) return;
    libraryTile.setAttribute(libraryAccent, "");
    const container = title && title.closest('[class*="list-row__header"]');
    if (!container || container.querySelector(`[${librarySpeaker}]`)) return;
    const speaker = document.createElement("span");
    speaker.setAttribute(librarySpeaker, "");
    speaker.setAttribute("role", "img");
    speaker.setAttribute("aria-label", "Playing");
    container.append(speaker);
  }

  function paint(view?: HTMLElement | null, playlist?: string, rows: PlaylistRow[] = []) {
    const active = activeSession();
    const activeUri = activePlaylist();
    const inPlaylist = !!playlist && activeUri === playlist;
    const current = player!._state?.item;
    const original = inPlaylist && current?.uid
      ? active?.originalByUid.get(current.uid) ?? context?.data.tracks.find(item => item.uid === current.uid)
      : undefined;
    const playing = host.playing();
    const nextHeader = inPlaylist && view?.querySelector<HTMLButtonElement>(headerButton);
    const nextProps = nextHeader && Array.from(rowProps(nextHeader, 8)).find(props => props.uri === playlist);
    if (nextHeader !== header?.button || !nextProps) clearHeader();
    if (nextHeader && nextProps) {
      header ??= { button: nextHeader, label: nextHeader.getAttribute("aria-label") };
      const nativeLabel = nextHeader.getAttribute("aria-label");
      if (nativeLabel !== header.written) header.label = nativeLabel;
      nextHeader.setAttribute(headerAccent, playing ? "true" : "false");
      const label = playing ? nextProps.ariaPauseLabel : nextProps.ariaPlayLabel;
      if (typeof label === "string") {
        nextHeader.setAttribute("aria-label", label);
        header.written = label;
      }
    }

    const retained = new Set<HTMLElement>();
    for (const row of rows) {
      retained.add(row.row);
      const item = context && rowItem(row, context.data.tracks);
      const replacement = item && context?.data.replacements.get(item);
      const selected = original && (item
        ? original === item || (!!original.uid && original.uid === item.uid)
        : active && rowItem(row, active.selection.tracks) === original);
      if (selected) row.row.setAttribute(rowAccent, playing ? "playing" : "paused");
      else row.row.removeAttribute(rowAccent);
      const existing = row.row.querySelector<HTMLButtonElement>(control);
      if (!replacement || !row.unavailable || row.restricted) {
        existing?.remove();
        continue;
      }
      const label = selected && playing ? "Pause matched local file" : "Play matched local file";
      if (existing) {
        if (existing.getAttribute("aria-label") !== label) existing.setAttribute("aria-label", label);
        continue;
      }
      const cell = row.row.querySelector(".main-trackList-rowSectionIndex");
      if (!cell?.querySelector(".main-trackList-rowMarker")) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.lyssnaLocalPlay = "";
      button.setAttribute("aria-label", label);
      cell.append(button);
    }
    for (const row of document.querySelectorAll<HTMLElement>(`[${rowAccent}]`)) {
      if (!retained.has(row)) row.removeAttribute(rowAccent);
    }
    for (const button of document.querySelectorAll(control)) {
      const row = button.closest<HTMLElement>(rowSelector);
      if (!row || !retained.has(row)) button.remove();
    }
  }

  async function scan() {
    const view = host.mainView();
    const uri = playlistUri();
    paintLibrary(host.playing() ? activePlaylist() : undefined);
    if (!view || !uri) {
      context = undefined;
      paint();
      return;
    }
    const rows = readRows(view, uri);
    const query = viewQuery(view, rows);
    const key = JSON.stringify([uri, query]);
    if (context?.key !== key) context = undefined;
    paint(view, uri, rows);
    if ((context && context.expires > Date.now()) || !rows.some(row => row.unavailable && !row.restricted)) return;
    const current = revision;
    const data = await read(uri, query, key).catch(() => undefined);
    if (!data || listeners.signal.aborted || current !== revision || playlistUri() !== uri) return;
    const latestRows = readRows(view, uri);
    if (JSON.stringify([uri, viewQuery(view, latestRows)]) !== key) return;
    context = { key, uri, data, expires: cache.get(key)?.expires ?? Date.now() };
    paint(view, uri, latestRows);
  }

  function schedule() {
    if (!frame && (playlistUri() || context || header || libraryTile || activePlaylist())) frame = requestAnimationFrame(() => {
      frame = 0;
      void scan();
    });
  }

  async function play(target: PlaylistItem, data: Selection, playlist: string) {
    const originalByUid = new Map<string, PlaylistItem>();
    const items = data.tracks.flatMap((item, index) => {
      const replacement = data.replacements.get(item);
      if (!item.uri || item.isBanned || item.is19PlusOnly || (item.isPlayable === false && !replacement)) return [];
      const uid = item.uid || `lyssna-${index}`;
      originalByUid.set(uid, item);
      return [{ uid, uri: replacement?.uri ?? item.uri, metadata: replacement?.metadata ?? item.metadata }];
    });
    const index = items.findIndex(item => item.uid && originalByUid.get(item.uid) === target);
    if (index < 0) throw new Error("The matched row is no longer in the playlist.");
    const uri = `spotify:trackset:Lyssna ${playlist.split(":")[2]} ${crypto.randomUUID()}`;
    const previous = session;
    const next = { uri, playlist, originalByUid, selection: data };
    session = next;
    try {
      const { uid, uri: local } = items[index];
      await player!.play({ uri, pages: [{ items }] }, { featureIdentifier: "playlist", viewURI: playlist },
        { skipTo: { uid, uri: local, index }, shuffle: host.shuffle(), repeat: { off: 0, context: 1, track: 2 }[host.repeat()] });
    } catch (error) {
      if (session === next) session = previous;
      throw error;
    }
    schedule();
  }

  function activate(event: MouseEvent | KeyboardEvent) {
    const element = event.target;
    if (!(element instanceof Element)) return;
    if (event.type === "click" && header && element.closest(headerButton) === header.button && activePlaylist() === playlistUri()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      host.toggle();
      return;
    }
    const button = element.closest(control);
    if (event.type === "click" ? !button : element.closest("a,button,input") || (event instanceof KeyboardEvent && event.key !== "Enter")) return;
    const row = element.closest<HTMLElement>(rowSelector);
    const uri = playlistUri();
    if (!row || !uri || context?.uri !== uri) return;
    const rendered = spotifyTrackRow(row);
    if (!rendered || rendered.context !== uri || !rendered.unavailable || rendered.restricted) return;
    const view = host.mainView();
    if (!view || JSON.stringify([uri, viewQuery(view, [rendered])]) !== context.key) {
      schedule();
      return;
    }
    const { data } = context;
    const selected = rowItem(rendered, data.tracks);
    if (!selected || !data.replacements.has(selected)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (row.hasAttribute(rowAccent) && activePlaylist() === uri) {
      host.toggle();
      return;
    }
    if (starting) return;
    starting = true;
    void play(selected, data, uri).catch(() => {
      if (!listeners.signal.aborted) host.notifyError("Spotify couldn’t play the matched local file.");
    }).finally(() => { starting = false; });
  }

  const observed = `${rowSelector}, ${headerButton}, ${libraryRow}, .x-sortBox-sortDropdown`;
  const observer = new MutationObserver(records => {
    if (records.some(record =>
      (record.target instanceof Element && record.target.closest(observed) && (record.type === "attributes" ||
        [...record.addedNodes, ...record.removedNodes].some(node =>
          !(node instanceof Element && node.matches(`${control}, [${librarySpeaker}]`))))) ||
      [...record.addedNodes, ...record.removedNodes].some(node =>
        node instanceof Element && (node.matches(observed) || node.querySelector(observed))),
    )) schedule();
  });
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-rowindex", "aria-disabled", "aria-sort", "data-uri"] });
  const signal = listeners.signal;
  for (const name of ["click", "dblclick", "keydown"] as const) document.addEventListener(name, activate, { signal, capture: true });
  document.addEventListener("input", event => {
    if (event.target instanceof Element && event.target.matches(".x-filterBox-filterInput")) schedule();
  }, { signal });
  window.addEventListener(lyricsChanged, () => {
    revision++;
    context = undefined;
    cache.clear();
    schedule();
  }, { signal });
  const stopRoute = host.watchViewSwitch(source => { if (source === "route") schedule(); });
  const stopPlayback = host.watchControls(() => {
    const state = JSON.stringify([host.playbackContextUri(), player._state?.item?.uid, host.playing()]);
    if (playbackState === state) return;
    playbackState = state;
    schedule();
  });
  schedule();
  return () => {
    listeners.abort();
    observer.disconnect();
    stopRoute();
    stopPlayback();
    cancelAnimationFrame(frame);
    paintLibrary();
    paint();
  };
}
