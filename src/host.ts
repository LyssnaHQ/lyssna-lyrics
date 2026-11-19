import type { ReactNode } from "react";
import { hosts } from "./host-react";

type Removal = () => void;
export type AudioSegment = { start: number; duration: number; pitches: number[]; loudness_max: number };
type AudioAnalysis = { segments?: AudioSegment[] };
type SpotifyTrack = {
  uri?: string;
  name?: string;
  artists?: Array<{ name?: string }>;
  images?: Array<{ url?: string }>;
  album?: { images?: Array<{ url?: string }> };
  metadata?: Record<string, string>;
};

export type Spicetify = {
  Config?: { extensions?: unknown };
  Platform?: Record<string, unknown>;
  CosmosAsync?: unknown;
  getAudioData?(uri: string): Promise<AudioAnalysis | null>;
  Queue?: { nextTracks?: { contextTrack?: SpotifyTrack; uri?: string }[] };
  Player: {
    data?: { item?: SpotifyTrack; isPaused?: boolean };
    origin?: { _state?: unknown };
    getProgress(): number;
    getDuration?(): number;
    getRepeat?(): number;
    getVolume?(): number;
    getHeart?(): boolean;
    isPlaying(): boolean;
    seek(ms: number): void;
    togglePlay(): void;
    next?(): void;
    back?(): void;
    setVolume?(level: number): void;
    addEventListener(event: string, callback: (event: unknown) => void): void;
    removeEventListener(event: string, callback: (event: unknown) => void): void;
  };
  Playbar: { Button: new (label: string, icon: string, click: () => void, disabled: boolean, active: boolean, registerOnCreate: boolean) => { register(): void; deregister(): void } };
};

type SpotiKit = {
  Config?: { extensions?: unknown };
  Platform: Record<string, unknown>;
  Http: unknown;
  Audio?: { analysis(uri: string): Promise<AudioAnalysis | null> };
  GraphQL?: { definitions?: Record<string, unknown>; request?: (...args: unknown[]) => unknown };
  URI?: object;
  Queue?: { next: { title: string; artist: string; image: string }[] };
  Player: {
    track: SpotifyTrack | null;
    state: { item?: SpotifyTrack; isPaused?: boolean } | null;
    isPlaying: boolean;
    position: number;
    duration: number;
    repeat: "off" | "context" | "track";
    volume: number;
    liked: boolean;
    seek(ms: number): void;
    toggle(): void;
    next(): void;
    previous(): void;
    setVolume(level: number): void;
    on(event: string, listener: (event: unknown) => void): Removal;
  };
  Topbar: { add(options: { label: string; icon: string; onClick: () => void }): { remove(): void } };
};

export type Root = { render(node: ReactNode): void; unmount(): void };
export type Track = { id: string; title: string; artists: string; cover: string };

export const spicetify = () => hosts.Spicetify as (typeof hosts.Spicetify & Spicetify) | undefined;
export const spotikit = () => hosts.SpotiKit as (typeof hosts.SpotiKit & SpotiKit) | undefined;

// Lyssna's player uses Lucide Mic2, an alias of MicVocal.
const icon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m11 7.601-5.994 8.19a1 1 0 0 0 .1 1.298l.817.818a1 1 0 0 0 1.314.087L15.09 12"/><path d="M16.5 21.174C15.5 20.5 14.372 20 13 20c-2.058 0-3.928 2.356-6 2-2.072-.356-2.775-3.369-1.5-4.5"/><circle cx="16" cy="7" r="5"/></svg>';

function artwork(url: string) {
  return url.replace(/^spotify:image:/, "https://i.scdn.co/image/");
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

  return {
    track(): Track | null {
      const track = kit ? kit.Player.track : spice?.Player.data?.item;
      const id = /^spotify:track:([A-Za-z0-9]+)$/.exec(track?.uri ?? "")?.[1];
      if (!id || !track) return null;
      return {
        id,
        title: track.name ?? track.metadata?.title ?? "",
        artists: track.artists?.map((artist) => artist.name).filter(Boolean).join(", ") || track.metadata?.artist_name || "",
        cover: artwork(track.images?.[0]?.url ?? track.album?.images?.[0]?.url ?? track.metadata?.image_url ?? ""),
      };
    },
    seek: (ms: number) => kit ? kit.Player.seek(ms) : spice?.Player.seek(ms),
    position: () => kit ? kit.Player.position : spice?.Player.getProgress() ?? 0,
    duration: () => kit ? kit.Player.duration : spice?.Player.getDuration?.() ?? 0,
    playing: () => kit ? kit.Player.isPlaying : spice?.Player.isPlaying() ?? false,
    toggle: () => kit ? kit.Player.toggle() : spice?.Player.togglePlay(),
    previous: () => kit ? kit.Player.previous() : spice?.Player.back?.(),
    next: () => kit ? kit.Player.next() : spice?.Player.next?.(),
    volume: () => kit ? kit.Player.volume : spice?.Player.getVolume?.() ?? 0,
    setVolume: (level: number) => kit ? kit.Player.setVolume(level) : spice?.Player.setVolume?.(level),
    upcoming() {
      const next = kit?.Queue?.next[0];
      if (next) return { title: next.title, artist: next.artist, image: artwork(next.image ?? "") };
      const track = spice?.Queue?.nextTracks?.[0]?.contextTrack;
      const title = track?.name ?? track?.metadata?.title;
      if (title) return { title, artist: track?.metadata?.artist_name ?? "", image: artwork(track?.metadata?.image_url ?? "") };
    },
    analysis: (trackId: string) => {
      const uri = `spotify:track:${trackId}`;
      return kit ? kit.Audio?.analysis(uri) : spice?.getAudioData?.(uri);
    },
    mainView() {
      return document.querySelector<HTMLElement>(".Root__main-view, .main-view-panel, #main-view");
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
    button(click: () => void): Removal {
      if (kit) {
        const button = kit.Topbar.add({ label: "Lyssna Lyrics", icon, onClick: click });
        return () => button.remove();
      }
      const button = new spice!.Playbar.Button("Lyssna Lyrics", icon, click, false, false, false);
      button.register();
      return () => button.deregister();
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
