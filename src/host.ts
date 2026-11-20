import type { ReactNode } from "react";
import { hosts } from "./host-react";
import { normalizeIsrc, spotifyTrackMetadata } from "./spotify-track-metadata";

type Removal = () => void;
type RepeatMode = "off" | "context" | "track";
type ButtonOptions = { label: string; icon: string; onClick: () => void };
type Button = { active: boolean; element?: HTMLElement; remove(): void };
type HistoryLocation = { pathname: string; search?: string; hash?: string };
const viewPath = (location?: HistoryLocation) => location?.pathname
  ? `${location.pathname}${location.search ?? ""}${location.hash ?? ""}`
  : undefined;
type HostConfig = { extensions?: unknown; custom_apps?: unknown; customApps?: unknown };
type SpotifyHistory = {
  location: HistoryLocation;
  entries?: HistoryLocation[];
  index?: number;
  go?(offset: number): void;
  push?(path: string): void;
  replace(path: string): void;
  listen(callback: (location?: HistoryLocation, action?: string) => void): Removal;
};
export type AudioSegment = { start: number; duration: number; pitches: number[]; loudness_max: number; loudness_start?: number; loudness_end?: number };
type AudioAnalysis = { segments?: AudioSegment[]; beats?: { start: number; duration: number }[]; track?: { duration?: number } };
type ImageSource = { url?: string; width?: number; maxWidth?: number };
type SpotifyHttp = { get(url: string): Promise<unknown> };
type HeaderImages = { sources?: ImageSource[] };
type CatalogueResult = {
  data?: { trackUnion?: { canvas?: CanvasInfo | null }; albumUnion?: { date?: { isoString?: string; year?: number } }; artistUnion?: {
    headerImage?: { data?: HeaderImages };
    visuals?: { headerImage?: HeaderImages };
  } };
};
export type CanvasInfo = { fileId?: string; type?: string; url?: string };
type SpotifyImage = { url?: string; width?: number; height?: number };
type SpotifyTrack = {
  uri?: string;
  name?: string;
  provider?: string;
  type?: string;
  artists?: Array<{ name?: string; uri?: string; id?: string }>;
  images?: SpotifyImage[];
  album?: { uri?: string; name?: string; images?: SpotifyImage[]; release_date?: string; releaseDate?: string; upc?: string };
  metadata?: Record<string, string>;
};
type PlayerState = {
  item?: SpotifyTrack;
  playbackId?: string;
  isPaused?: boolean;
  context?: { uri?: string; metadata?: Record<string, string> };
  restrictions?: { disallowSeekingReasons?: string[] };
  signals?: string[];
  nextItems?: SpotifyTrack[];
};
type PlayerAPI = {
  _state?: PlayerState | null;
  sendSignal?(signal: string): unknown;
  setRepeat?(mode: number): unknown;
  skipTo?(item: SpotifyTrack): unknown;
  _events?: {
    addListener(event: "update", listener: () => void): void;
    removeListener?(event: "update", listener: () => void): void;
  };
};

export type Spicetify = {
  Config?: HostConfig;
  Platform?: Record<string, unknown>;
  _platform?: { isDeveloperMode?: boolean };
  showNotification?(message: string, error?: boolean): void;
  Menu?: { Item: new (label: string, enabled: boolean, onClick: () => void, icon?: string) => {
    register(): void; deregister(): void;
  } };
  CosmosAsync?: SpotifyHttp;
  GraphQL?: {
    Definitions: Record<string, unknown>;
    Request(definition: unknown, variables: Record<string, unknown>): Promise<CatalogueResult>;
  };
  getAudioData?(uri: string): Promise<AudioAnalysis | null>;
  Queue?: { nextTracks?: { contextTrack?: SpotifyTrack; uri?: string }[] };
  Player: {
    data?: PlayerState;
    origin?: PlayerAPI;
    getProgress(): number;
    getDuration?(): number;
    getRepeat?(): number;
    getShuffle?(): boolean;
    getVolume?(): number;
    getHeart?(): boolean;
    isPlaying(): boolean;
    seek(ms: number): void;
    playUri?(uri: string): unknown;
    togglePlay(): void;
    next?(): void;
    back?(): void;
    setVolume?(level: number): void;
    setRepeat?(mode: number): void;
    toggleShuffle?(): void;
    toggleHeart?(): void;
    addEventListener(event: string, callback: (event: unknown) => void): void;
    removeEventListener(event: string, callback: (event: unknown) => void): void;
  };
  Playbar: { Button: new (label: string, icon: string, click: () => void, disabled: boolean, active: boolean, registerOnCreate: boolean) => {
    active: boolean; element: HTMLButtonElement; register(): void; deregister(): void;
  } };
};

type SpotiKit = {
  Config?: HostConfig;
  Platform: Record<string, unknown>;
  Http: SpotifyHttp;
  Audio?: { analysis(uri: string): Promise<AudioAnalysis | null> };
  GraphQL?: {
    definitions?: Record<string, unknown>;
    request?(definition: unknown, variables: Record<string, unknown>): Promise<CatalogueResult>;
  };
  URI?: object;
  Queue?: { next: { title: string; artist: string; image: string }[] };
  Player: {
    track: SpotifyTrack | null;
    state: PlayerState | null;
    isPlaying: boolean;
    position: number;
    duration: number;
    repeat: RepeatMode;
    shuffle: boolean;
    volume: number;
    liked: boolean;
    seek(ms: number): void;
    playUri?(uri: string): unknown;
    toggle(): void;
    next(): void;
    previous(): void;
    setVolume(level: number): void;
    setRepeat?(mode: RepeatMode): unknown;
    setShuffle?(on: boolean): unknown;
    setLiked?(liked: boolean): unknown;
    on(event: string, listener: (event: unknown) => void): Removal;
  };
  Playbar?: { add(options: ButtonOptions): Button };
  ProfileMenu?: { add(options: { label: string; icon: string; onSelect(): void }): { remove(): void } };
  Topbar: { add(options: ButtonOptions): Button };
};

export type Root = { render(node: ReactNode): void; unmount(): void };
export type Track = { id: string; title: string; artists: string; artist?: string; artistUri?: string; cover: string;
  artistLinks?: { name: string; uri?: string }[]; album?: string; albumUri?: string; albumUpc?: string; year?: string; isrc?: string };
type CatalogueAlbum = {
  uri?: string;
  name?: string;
  artists?: { name: string }[];
  images?: { url: string; width?: number; height?: number }[];
  release_date?: string;
  album_type?: string;
  total_tracks?: number;
  genres?: string[];
  label?: string;
  copyrights?: { type: string; text: string }[];
  external_ids?: { upc?: string; ean?: string };
};
export type TtmlTrack = {
  uri: string;
  name: string;
  artists: { name: string }[];
  album?: CatalogueAlbum;
  disc_number?: number;
  track_number?: number;
  explicit?: boolean;
  external_ids?: { isrc?: string };
};

function isTtmlTrack(value: unknown): value is TtmlTrack {
  const track = value as Partial<TtmlTrack> | null;
  return !!track && typeof track.uri === "string" && /^spotify:track:[A-Za-z0-9]{22}$/.test(track.uri) &&
    typeof track.name === "string" && Array.isArray(track.artists);
}

export function cataloguePath(uri?: string) {
  const match = /^(?:spotify:)(album|artist):([A-Za-z0-9]{22})$/.exec(uri ?? "");
  return match ? `/${match[1]}/${match[2]}` : undefined;
}

export const spicetify = () => hosts.Spicetify as (typeof hosts.Spicetify & Spicetify) | undefined;
export const spotikit = () => hosts.SpotiKit as (typeof hosts.SpotiKit & SpotiKit) | undefined;

// Lyssna's player uses Lucide Mic2, an alias of MicVocal.
const icon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m11 7.601-5.994 8.19a1 1 0 0 0 .1 1.298l.817.818a1 1 0 0 0 1.314.087L15.09 12"/><path d="M16.5 21.174C15.5 20.5 14.372 20 13 20c-2.058 0-3.928 2.356-6 2-2.072-.356-2.775-3.369-1.5-4.5"/><circle cx="16" cy="7" r="5"/></svg>';

function artwork(url: string) {
  return url.replace(/^spotify:image:/, "https://i.scdn.co/image/");
}

function albumArtwork(track: SpotifyTrack) {
  const metadata = track.metadata;
  const sized = metadata?.image_xlarge_url || metadata?.image_large_url;
  if (sized) return artwork(sized);
  const images = [...(track.album?.images ?? []), ...(track.images ?? [])];
  const size = (image: SpotifyImage) => image.width ?? image.height ??
    (image.url?.includes("ab67616d0000b273") ? 640 : image.url?.includes("ab67616d00001e02") ? 300 : 0);
  const largest = images.reduce<SpotifyImage | undefined>((best, image) =>
    image.url && (!best || size(image) > size(best)) ? image : best, undefined);
  return artwork(largest?.url || metadata?.image_url || "");
}

const repeatModes = ["off", "context", "track"] as const;
const djContexts = new Set([
  "spotify:playlist:37i9dQZF1EYkqdzj48dyYq",
  "spotify:playlist:37i9dQZF1EYkqdzj8OSOas",
  "spotify:playlist:37i9dQZF1EYkqdzjdvy3mw",
  "spotify:playlist:37i9dQZF1EYkqdzjicdiyA",
  "spotify:playlist:37i9dQZF1EYkqdzjmSSxKE",
  "spotify:playlist:37i9dQZF1EYkqdzjrzxMWI",
]);
function isDJContext(context?: PlayerState["context"]) {
  return context?.metadata?.lexicon_set_type === "your_dj" || djContexts.has(context?.uri ?? "");
}

function isDJNarration(state?: PlayerState | null) {
  if (!state?.item) return false;
  const { item } = state;
  if (item.provider?.startsWith("narration") ||
    state.restrictions?.disallowSeekingReasons?.some((reason) => reason.includes("narration"))) return true;
  return isDJContext(state.context) && (item.metadata?.is_narration === "true" || item.type === "unknown");
}
const nativeLyricsButton = 'button[data-testid="lyrics-button"]';
const otherLyricsButtons = `${nativeLyricsButton}, #LyssnaLyrics_PageButton, #LyssnaLyrics_FullscreenButton`;
const lyricsRoute = (location?: HistoryLocation) => /^\/(?:lyrics|spicylyrics|lyssnalyrics)(?:\/|$)/i.test(location?.pathname ?? "");

function customAppRoutes(config?: HostConfig) {
  const configured = config?.custom_apps ?? config?.customApps;
  const entries: unknown[] = typeof configured === "string" ? configured.split("|") : Array.isArray(configured) ? configured : [];
  return entries.filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim().toLowerCase()).filter(Boolean);
}

function headerImage(result: CatalogueResult) {
  const artist = result?.data?.artistUnion;
  const images = artist?.headerImage?.data?.sources ?? artist?.visuals?.headerImage?.sources ?? [];
  let preferred: { url: string; width: number } | undefined;
  for (const image of images) {
    if (!image.url) continue;
    const url = artwork(image.url);
    if (!/^https:\/\/(?:i\.scdn\.co|image-cdn-[a-z0-9-]+\.spotifycdn\.com)\//i.test(url)) continue;
    const width = image.maxWidth ?? image.width ?? 0;
    if (!preferred || width > preferred.width) preferred = { url, width };
  }
  return preferred?.url;
}

export function getHost() {
  const kit = spotikit();
  const spice = spicetify();
  const dom = (kit?.ReactDOM ?? spice?.ReactDOM) as {
    createRoot?: (container: HTMLElement) => Root;
    render?: (node: ReactNode, container: HTMLElement) => void;
    unmountComponentAtNode?: (container: HTMLElement) => void;
  } | undefined;
  if ((!kit && !spice) || !dom) throw new Error("Spotify host is unavailable");
  const history = () => (kit?.Platform.History ?? spice?.Platform?.History) as SpotifyHistory | undefined;
  const customApps = new Set(["marketplace", "lyrics-plus", ...customAppRoutes(spice?.Config), ...customAppRoutes(kit?.Config)]);
  const spotifyWeb = kit?.Http ?? spice?.CosmosAsync;
  const otherMainView = (location?: HistoryLocation) => {
    const [route, app] = location?.pathname.toLowerCase().slice(1).split("/") ?? [];
    return lyricsRoute(location) || customApps.has(route === "app" ? app : route);
  };

  const artistHeaders = new Map<string, Promise<string | undefined>>();
  const releaseYears = new Map<string, Promise<string | undefined>>();
  const canvases = new Map<string, Promise<CanvasInfo | null | undefined>>();
  const analyses = new Map<string, Promise<AudioAnalysis | null>>();
  const currentTrack = () => kit?.Player.state?.item ?? kit?.Player.track ?? spice?.Player.data?.item;
  async function lookupWebTrack(id: string) {
    if (!/^[A-Za-z0-9]{22}$/.test(id)) return;
    const track = await spotifyWeb?.get(`https://api.spotify.com/v1/tracks/${id}`).catch(() => undefined);
    return isTtmlTrack(track) ? track : undefined;
  }
  async function lookupTrack(id: string) {
    const track = await lookupWebTrack(id);
    if (track) return track;
    const native = await spotifyTrackMetadata(id);
    return isTtmlTrack(native) ? native : undefined;
  }
  const playerAPI = () => (kit?.Platform.PlayerAPI as PlayerAPI | undefined) ?? spice?.Player.origin;
  const playerState = (player = playerAPI()) => player?._state ?? kit?.Player.state ?? spice?.Player.data;
  function djAction() {
    const player = playerAPI();
    const state = playerState(player);
    if (!player || !state) return;
    if (player.sendSignal && state.signals?.includes("jump")) return () => player.sendSignal?.("jump");
    if (!player.skipTo || !state.item || !isDJContext(state.context) || isDJNarration(state)) return;
    const queue = state.nextItems;
    const jump = queue?.find((item) => item.metadata?.jump_track) ??
      queue?.find((item) => item.metadata?.["narration.intro.ssml"] || item.metadata?.["narration.jump.ssml"]);
    if (jump) return () => player.skipTo?.(jump);
  }
  function graph() {
    const spiceGraph = spice?.GraphQL;
    const kitGraph = kit?.GraphQL;
    return {
      definitions: kitGraph?.definitions ?? spiceGraph?.Definitions,
      request: kitGraph?.request?.bind(kitGraph) ?? spiceGraph?.Request?.bind(spiceGraph),
    };
  }
  function trackCanvas(trackId: string) {
    const trackUri = `spotify:track:${trackId}`;
    const item = currentTrack();
    const metadata = item?.uri === trackUri ? item.metadata : undefined;
    if (metadata?.["canvas.fileId"] || metadata?.["canvas.url"]) {
      return Promise.resolve({ fileId: metadata["canvas.fileId"], type: metadata["canvas.type"], url: metadata["canvas.url"] });
    }
    const cached = canvases.get(trackId);
    if (cached) return cached;
    const { definitions, request } = graph();
    if (!definitions?.canvas || !request) return;
    const definition = definitions.canvas;
    const pending = Promise.resolve().then(() => request(definition, { trackUri })).then((result) => {
      if (!result.data?.trackUnion) throw new Error("Canvas lookup returned no track");
      return result.data.trackUnion.canvas ?? null;
    }).catch(() => {
      if (canvases.get(trackId) === pending) canvases.delete(trackId);
      return undefined;
    });
    canvases.set(trackId, pending);
    if (canvases.size > 50) canvases.delete(canvases.keys().next().value!);
    return pending;
  }
  function artistHeader(artistUri: string, trackId: string) {
    const cached = artistHeaders.get(artistUri);
    if (cached) return cached;
    const { definitions, request } = graph();
    if (!definitions || !request) return;
    const npv = definitions.queryNpvArtist;
    const overview = definitions.queryArtistOverview;
    if (!npv && !overview) return;
    const pending = (async () => {
      if (npv) {
        const image = await request(npv, {
          artistUri, trackUri: `spotify:track:${trackId}`, contributorsLimit: 10, contributorsOffset: 0,
          enableRelatedVideos: false, enableRelatedAudioTracks: false,
        }).then(headerImage).catch((error) => {
          if (!overview) throw error;
        });
        if (image) return image;
      }
      if (overview) return headerImage(await request(overview, { uri: artistUri, locale: "", preReleaseV2: false, offset: 0, limit: 10 }));
    })().catch(() => {
      artistHeaders.delete(artistUri);
      return undefined;
    });
    artistHeaders.set(artistUri, pending);
    return pending;
  }

  function releaseYear(uri: string) {
    const cached = releaseYears.get(uri);
    if (cached) return cached;
    const { definitions, request } = graph();
    if (!definitions?.getAlbum || !request) return;
    const pending = request(definitions.getAlbum, { uri, locale: "", offset: 0, limit: 1 }).then((result) => {
      const date = result.data?.albumUnion?.date;
      return /^(\d{4})(?:-|$)/.exec(date?.isoString ?? String(date?.year ?? ""))?.[1];
    }).catch(() => {
      releaseYears.delete(uri);
      return undefined;
    });
    releaseYears.set(uri, pending);
    return pending;
  }

  return {
    profileSettings(onSelect: () => void): Removal {
      const label = "Lyssna Lyrics settings";
      const menuIcon = icon.replace('width="20" height="20"', 'width="16" height="16"');
      if (kit?.ProfileMenu) {
        const item = kit.ProfileMenu.add({ label, icon: menuIcon, onSelect });
        return () => item.remove();
      }
      if (spice?.Menu) {
        const item = new spice.Menu.Item(label, false, onSelect, menuIcon);
        item.register();
        return () => item.deregister();
      }
      return () => {};
    },
    get developerMode() {
      const flag = kit?.Platform.isDeveloperMode ?? spice?.Platform?.isDeveloperMode ?? spice?._platform?.isDeveloperMode;
      return typeof flag === "boolean" ? flag : undefined;
    },
    notifyError(message: string) {
      if (spice?.showNotification) spice.showNotification(message, true);
      else console.warn(`[Lyssna Lyrics] ${message}`);
    },
    track(): Track | null {
      const track = kit ? kit.Player.track : spice?.Player.data?.item;
      const id = /^spotify:track:([A-Za-z0-9]+)$/.exec(track?.uri ?? "")?.[1];
      if (!id || !track) return null;
      const artist = track.artists?.[0];
      const artistUri = [artist?.uri, track.metadata?.artist_uri, artist?.id && `spotify:artist:${artist.id}`]
        .find((uri) => uri && /^spotify:artist:[A-Za-z0-9]{22}$/.test(uri));
      const artistLinks = track.artists?.flatMap((artist, index) => artist.name ? [{
        name: artist.name, uri: artist.uri || (artist.id ? `spotify:artist:${artist.id}` : index === 0 ? artistUri : undefined),
      }] : []);
      return {
        id,
        title: track.name ?? track.metadata?.title ?? "",
        artists: track.artists?.map((artist) => artist.name).filter(Boolean).join(", ") || track.metadata?.artist_name || "",
        artistUri,
        artistLinks,
        artist: artist?.name || track.metadata?.artist_name,
        album: track.album?.name ?? track.metadata?.album_title,
        albumUri: track.album?.uri || track.metadata?.album_uri,
        albumUpc: track.album?.upc ?? track.metadata?.album_upc,
        isrc: normalizeIsrc(track.metadata?.isrc),
        year: /^(\d{4})(?:-|$)/.exec(track.album?.release_date ?? track.album?.releaseDate ?? track.metadata?.album_release_date ?? "")?.[1],
        cover: albumArtwork(track),
      };
    },
    seek: (ms: number) => kit ? kit.Player.seek(ms) : spice?.Player.seek(ms),
    async playTrack(uri: string) {
      const player = kit?.Player ?? spice?.Player;
      if (!player?.playUri) throw new Error("This Spotify client cannot open saved songs.");
      await player.playUri(uri);
    },
    async searchTracks(query: string, limit = 6) {
      if (!spotifyWeb) throw new Error("Spotify search is unavailable.");
      const params = new URLSearchParams({ q: query, type: "track", limit: String(limit) });
      const result = await spotifyWeb.get(`https://api.spotify.com/v1/search?${params}`) as { tracks?: { items?: unknown[] } };
      if (!Array.isArray(result?.tracks?.items)) throw new Error("Spotify search is unavailable.");
      return [...new Map(result.tracks.items.filter(isTtmlTrack).map((track) => [track.uri, track])).values()];
    },
    lookupTrack,
    async lookupIsrc(id: string, known?: string) {
      return normalizeIsrc(known) ?? (await spotifyTrackMetadata(id))?.external_ids?.isrc
        ?? normalizeIsrc((await lookupWebTrack(id))?.external_ids?.isrc);
    },
    async lookupAlbum(uri?: string) {
      const id = /^spotify:album:([A-Za-z0-9]{22})$/.exec(uri ?? "")?.[1];
      if (!spotifyWeb || !id) return;
      return await spotifyWeb.get(`https://api.spotify.com/v1/albums/${id}`) as CatalogueAlbum | undefined;
    },
    spotifyLyrics(id: string) {
      if (!spotifyWeb || !/^[A-Za-z0-9]{22}$/.test(id)) return;
      return spotifyWeb.get(`https://spclient.wg.spotify.com/color-lyrics/v2/track/${id}?format=json&vocalRemoval=false&market=from_token`);
    },
    position: () => kit ? kit.Player.position : spice?.Player.getProgress() ?? 0,
    duration: () => kit ? kit.Player.duration : spice?.Player.getDuration?.() ?? 0,
    playing: () => kit ? kit.Player.isPlaying : spice?.Player.isPlaying() ?? false,
    toggle: () => kit ? kit.Player.toggle() : spice?.Player.togglePlay(),
    previous: () => kit ? kit.Player.previous() : spice?.Player.back?.(),
    next: () => kit ? kit.Player.next() : spice?.Player.next?.(),
    volume: () => kit ? kit.Player.volume : spice?.Player.getVolume?.() ?? 0,
    setVolume: (level: number) => kit ? kit.Player.setVolume(level) : spice?.Player.setVolume?.(level),
    repeat: () => kit ? kit.Player.repeat : repeatModes[spice?.Player.getRepeat?.() ?? 0] ?? "off",
    setRepeat(mode: RepeatMode) {
      if (kit) return kit.Player.setRepeat?.(mode);
      const player = spice?.Player.origin;
      const index = repeatModes.indexOf(mode);
      return player?.setRepeat ? player.setRepeat(index) : spice?.Player.setRepeat?.(index);
    },
    shuffle: () => kit ? kit.Player.shuffle : spice?.Player.getShuffle?.() ?? false,
    toggleShuffle: () => kit ? kit.Player.setShuffle?.(!kit.Player.shuffle) : spice?.Player.toggleShuffle?.(),
    liked: () => kit ? kit.Player.liked : spice?.Player.getHeart?.() ?? false,
    toggleLiked: () => kit ? kit.Player.setLiked?.(!kit.Player.liked) : spice?.Player.toggleHeart?.(),
    canJumpDJ: () => !!djAction(),
    jumpDJ: () => djAction()?.(),
    djNarrating: () => isDJNarration(playerState()),
    playbackId: () => playerState()?.playbackId,
    artistHeader,
    releaseYear,
    trackCanvas,
    navigate(path: string) {
      const routes = history();
      if (!routes) return false;
      if (routes.push) routes.push(path);
      else routes.replace(path);
      return true;
    },
    upcoming() {
      const next = kit?.Queue?.next[0];
      if (next) return { title: next.title, artist: next.artist, image: artwork(next.image ?? "") };
      const track = spice?.Queue?.nextTracks?.[0]?.contextTrack;
      const title = track?.name ?? track?.metadata?.title;
      if (title) return { title, artist: track?.metadata?.artist_name ?? "", image: artwork(track?.metadata?.image_url ?? "") };
    },
    analysis: (trackId: string) => {
      const cached = analyses.get(trackId);
      if (cached) return cached;
      const uri = `spotify:track:${trackId}`;
      const load = kit ? kit.Audio?.analysis(uri) : spice?.getAudioData?.(uri);
      if (!load) return;
      const pending = load.catch(() => null);
      analyses.set(trackId, pending);
      if (analyses.size > 12) analyses.delete(analyses.keys().next().value!);
      return pending;
    },
    mainView() {
      return document.querySelector<HTMLElement>(".Root__main-view, .main-view-panel, #main-view");
    },
    viewLocation: () => viewPath(history()?.location),
    restoreView(path: string) {
      history()?.replace(path);
    },
    async leaveOtherLyricsView() {
      const routes = history();
      if (routes && otherMainView(routes.location)) {
        const index = routes.index ?? 0;
        const previous = routes.entries?.slice(0, index).findLastIndex((location) => !otherMainView(location)) ?? -1;
        const go = routes.go?.bind(routes);
        if (go && previous >= 0) {
          // Browser history can finish after the button handler returns. Wait so
          // its route notification closes the old page before mounting ours.
          let unlisten: Removal | undefined;
          let timeout: number | undefined;
          try {
            await new Promise<void>((resolve) => {
              unlisten = routes.listen(() => { if (!otherMainView(routes.location)) resolve(); });
              timeout = window.setTimeout(resolve, 500);
              go(previous - index);
            });
          } finally {
            clearTimeout(timeout);
            unlisten?.();
          }
        }
        if (otherMainView(routes.location)) routes.replace("/");
        return;
      }
      // Some Spotify clients open lyrics as a Now Playing sidebar variant.
      document.querySelector<HTMLButtonElement>(`${nativeLyricsButton}[aria-pressed="true"]`)?.click();
    },
    watchViewSwitch(listener: (source: "route" | "lyrics") => void): Removal {
      const routes = history();
      let previous = viewPath(routes?.location);
      const unlisten = routes?.listen?.((_location, action) => {
        const current = viewPath(routes.location);
        // Spotify replaces the history entry when reselecting the current playlist.
        if (current === previous && action !== "PUSH" && action !== "POP" && action !== "REPLACE") return;
        previous = current;
        listener("route");
      });
      const selectLyrics = (event: MouseEvent) => {
        if (event.target instanceof Element && event.target.closest(otherLyricsButtons)) listener("lyrics");
      };
      document.addEventListener("click", selectLyrics, true);
      return () => {
        unlisten?.();
        document.removeEventListener("click", selectLyrics, true);
      };
    },
    watch(listener: () => void, progress = false): Removal {
      if (kit) {
        const events = progress ? ["track", "playpause", "state"] : ["track", "playpause"];
        const remove = events.map((event) => kit.Player.on(event, listener));
        return () => remove.forEach((dispose) => dispose());
      }
      const events = progress ? ["songchange", "onplaypause", "onprogress"] : ["songchange", "onplaypause"];
      for (const event of events) spice?.Player.addEventListener(event, listener);
      return () => events.forEach((event) => spice?.Player.removeEventListener(event, listener));
    },
    watchControls(listener: () => void): Removal {
      if (kit) return kit.Player.on("state", listener);
      const events = spice?.Player.origin?._events;
      if (!events?.removeListener) return this.watch(listener, true);
      events.addListener("update", listener);
      return () => events.removeListener?.("update", listener);
    },
    button(label: string, click: () => void) {
      if (kit) {
        const button = (kit.Playbar ?? kit.Topbar).add({ label, icon, onClick: click });
        if (kit.Playbar && button.element) button.element.dataset.lyssnaPlaybarLyrics = "";
        return {
          setActive(active: boolean) { button.active = active; },
          remove: () => button.remove(),
        };
      }
      const button = new spice!.Playbar.Button(label, icon, click, false, false, false);
      button.element.dataset.lyssnaPlaybarLyrics = "";
      button.element.classList.add("lyssna-playbar-button");
      button.element.setAttribute("aria-label", label);
      button.element.setAttribute("aria-pressed", "false");
      button.register();
      return {
        setActive(active: boolean) {
          button.active = active;
          button.element.setAttribute("aria-pressed", String(active));
        },
        remove: () => button.deregister(),
      };
    },
    mount(container: HTMLElement): Root {
      return dom.createRoot?.(container) ?? {
        render: (node) => dom.render?.(node, container),
        unmount: () => { dom.unmountComponentAtNode?.(container); },
      };
    },
  };
}

export type Host = ReturnType<typeof getHost>;
