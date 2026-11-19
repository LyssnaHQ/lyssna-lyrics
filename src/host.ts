import type { ReactNode } from "react";
import { hosts } from "./host-react";

type Removal = () => void;
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
  Player: {
    data?: { item?: SpotifyTrack; isPaused?: boolean };
    origin?: { _state?: unknown };
    getProgress(): number;
    getRepeat?(): number;
    getVolume?(): number;
    getHeart?(): boolean;
    isPlaying(): boolean;
    seek(ms: number): void;
    togglePlay(): void;
    addEventListener(event: string, callback: (event: unknown) => void): void;
    removeEventListener(event: string, callback: (event: unknown) => void): void;
  };
  Playbar: { Button: new (label: string, icon: string, click: () => void, disabled: boolean, active: boolean, registerOnCreate: boolean) => { register(): void; deregister(): void } };
};

type SpotiKit = {
  Config?: { extensions?: unknown };
  Platform: Record<string, unknown>;
  Http: unknown;
  GraphQL?: { definitions?: Record<string, unknown>; request?: (...args: unknown[]) => unknown };
  URI?: object;
  Player: {
    track: SpotifyTrack | null;
    state: { item?: SpotifyTrack; isPaused?: boolean } | null;
    isPlaying: boolean;
    position: number;
    repeat: "off" | "context" | "track";
    volume: number;
    liked: boolean;
    seek(ms: number): void;
    toggle(): void;
    on(event: string, listener: (event: unknown) => void): Removal;
  };
  Topbar: { add(options: { label: string; icon: string; onClick: () => void }): { remove(): void } };
};

export type Root = { render(node: ReactNode): void; unmount(): void };
export type Track = { id: string; title: string; artists: string; cover: string };

export const spicetify = () => hosts.Spicetify as (typeof hosts.Spicetify & Spicetify) | undefined;
export const spotikit = () => hosts.SpotiKit as (typeof hosts.SpotiKit & SpotiKit) | undefined;

const icon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/></svg>';

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
    playing: () => kit ? kit.Player.isPlaying : spice?.Player.isPlaying() ?? false,
    toggle: () => kit ? kit.Player.toggle() : spice?.Player.togglePlay(),
    watch(listener: () => void): Removal {
      if (kit) {
        const remove = [kit.Player.on("track", listener), kit.Player.on("playpause", listener)];
        return () => remove.forEach((dispose) => dispose());
      }
      const events = ["songchange", "onplaypause"];
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
