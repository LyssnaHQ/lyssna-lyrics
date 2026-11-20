import { spicetify, spotikit } from "../host";

type Callback = (uris: string[], uids?: string[], contextUri?: string) => void;
type Predicate = (...args: Parameters<Callback>) => boolean;
type MenuItem = { register(): void };
type PlaybarButton = { element: HTMLButtonElement; register(): void; deregister(): void };
type PlaybarButtonConstructor = new (label: string, icon: string, click?: () => void,
  disabled?: boolean, active?: boolean, registerOnCreate?: boolean) => PlaybarButton;
type PlaylistMetadata = {
  madeFor?: unknown;
  canAdd?: boolean;
  canEditItems?: boolean;
  formatListData?: { type?: string };
};
type PlaylistResult = {
  data?: { playlistV2?: { images?: { items?: { sources?: { url?: string }[] }[] } } };
};
type PlayerData = { item?: { uri?: string; uid?: string }; context?: { uri?: string } };
type Platform = {
  PlaylistAPI?: {
    getMetadata?(uri: string): Promise<PlaylistMetadata | undefined>;
    getContents?(uri: string, options: { limit: number }): Promise<{ items?: { uri?: string; link?: string }[] }>;
    add?(playlist: string, tracks: string[], options: object): Promise<unknown>;
  };
  RootlistAPI?: {
    getContents?(options?: object): Promise<unknown>;
    getRootContents?(): Promise<unknown>;
  };
  ConnectAPI?: unknown;
  ConnectDevicesAPI?: unknown;
  ConnectTransferAPI?: unknown;
  ClipboardAPI?: { copy?(value: string): void };
};

export type { Callback, Predicate, PlaybarButton };

type LegacyHost = {
  Platform?: Platform;
  Playbar?: { Button?: PlaybarButtonConstructor };
  LocalStorage?: { get(key: string): string | null; set(key: string, value: string): void };
  Config?: { extensions?: unknown };
  Player?: { data?: PlayerData };
  URI?: { fromString(uri: string): { type: string; toURLPath(useNative?: boolean): string } };
  GraphQL?: { Definitions?: Record<string, unknown>; Request(definition: unknown, vars: object): Promise<PlaylistResult> };
  SVGIcons?: { copy?: string };
  Locale?: { get?(key: string): string };
  ContextMenu?: {
    Item: new (name: string, click: Callback, when: Predicate, icon?: string, trailingIcon?: string, disabled?: boolean) => MenuItem;
    SubMenu: new (name: string, items: MenuItem[], when: Predicate, disabled?: boolean, icon?: string) => MenuItem;
  };
  showNotification?(message: string, error?: boolean): void;
};

type KitTarget = { uris: string[]; uids?: string[]; contextUri?: string | null };
export type KitMenuOptions = {
  label: string; icon?: string; disabled?: boolean;
  when: (target: KitTarget) => boolean;
  onSelect?: (target: KitTarget) => void;
  items?: KitMenuOptions[];
};

const spice = spicetify() as LegacyHost | undefined;
export const kit = spotikit() as {
  Config?: { extensions?: unknown };
  Platform: Platform;
  Player: { state: PlayerData | null };
  Playbar?: { add(options: { label: string; icon: string }): { element: HTMLElement; remove(): void } };
  GraphQL?: { definitions?: Record<string, unknown>; request?(definition: unknown, vars: object): Promise<PlaylistResult> };
  ContextMenu?: { add(options: KitMenuOptions): void };
  notify?(message: string, options?: { error?: boolean }): void;
  URI?: { toUrl(uri: string): string };
} | undefined;

class KitPlaybarButton implements PlaybarButton {
  private button;
  element: HTMLButtonElement;
  constructor(label: string, icon: string) {
    this.button = kit!.Playbar!.add({ label, icon });
    this.element = this.button.element as HTMLButtonElement;
  }
  register() {}
  deregister() { this.button.remove(); }
}

export const Spicetify = spice ?? {
  Platform: kit?.Platform,
  Config: kit?.Config,
  Player: { get data() { return kit?.Player.state ?? undefined; } },
  Playbar: { Button: kit?.Playbar ? KitPlaybarButton as PlaybarButtonConstructor : undefined },
  URI: {
    fromString(uri: string) {
      const kind = uri.split(":")[1];
      const url = kit?.URI?.toUrl(uri);
      if (!url) throw new Error("Unsupported Spotify URI");
      return { type: kind, toURLPath: () => url };
    },
  },
  GraphQL: {
    get Definitions() { return kit?.GraphQL?.definitions; },
    async Request(definition: unknown, vars: object) { return await kit?.GraphQL?.request?.(definition, vars) ?? {}; },
  },
  showNotification: (message: string, error?: boolean) => { kit?.notify?.(message, { error }); },
} satisfies LegacyHost as LegacyHost;

export const storage = spice?.LocalStorage ?? {
  get: (key: string) => localStorage.getItem(key),
  set: (key: string, value: string) => localStorage.setItem(key, value),
};
