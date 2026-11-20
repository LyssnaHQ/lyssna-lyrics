import { spicetify, spotikit, type Spicetify } from "./host";
import * as jsxRuntime from "./host-jsx";
import type { Contributor, Line, Lyrics, Word } from "./lyssna/types";

const api = "https://api.spicylyrics.org/bp/loader/";
const cacheName = "SpicyLyrics_LyricsStore_g1";
const spicyName = /spicy[\W_]*lyrics/i;
type ProviderWindow = Window & {
  SpicyLyrics?: { db?: { objectStores?: { lyricsStore?: { manager?: { get(uri: string): Promise<unknown> } } } } };
  __LYSSNA_SPICY_BACKGROUND__?: { ready?: Promise<Window | null>; frameWindow?: Window | null };
};
let ownProviderFrame: Window | undefined;

function legacyProviderAvailable() {
  const legacy = (window as ProviderWindow).__LYSSNA_SPICY_BACKGROUND__;
  return !!legacy?.ready && legacy.frameWindow !== null;
}

export function standaloneSpicyInstalled() {
  const globals = window as Window & { _spicy_lyrics?: unknown; SpicyLyrics?: unknown };
  if (globals._spicy_lyrics || globals.SpicyLyrics) return true;
  if (Array.from(document.scripts).some((script) => spicyName.test(script.src))) return true;
  const extensions = spicetify()?.Config?.extensions ?? spotikit()?.Config?.extensions;
  if (typeof extensions === "string") return spicyName.test(extensions);
  return Array.isArray(extensions) && extensions.some((entry: unknown) => {
    if (typeof entry === "string") return spicyName.test(entry);
    if (!entry || typeof entry !== "object") return false;
    const addon = entry as { name?: string; id?: string; path?: string; enabled?: boolean };
    return addon.enabled !== false && [addon.name, addon.id, addon.path].some((value) => value && spicyName.test(value));
  });
}

function externalProviderAvailable() {
  return standaloneSpicyInstalled() || legacyProviderAvailable();
}

type ProviderHost = Pick<Spicetify, "Config" | "Platform" | "CosmosAsync"> & {
  Player: Omit<Spicetify["Player"], "seek" | "togglePlay">;
};

function nativeProviderHost(): ProviderHost | undefined {
  const kit = spotikit();
  if (!kit?.Player || !kit.Platform || !kit.Http) return;
  const player = kit.Player;
  const listeners = new Map<(event: unknown) => void, () => void>();
  const provider = {
    Config: kit.Config,
    Platform: kit.Platform,
    CosmosAsync: kit.Http,
    GraphQL: { Definitions: kit.GraphQL?.definitions ?? {}, Request: kit.GraphQL?.request?.bind(kit.GraphQL) },
    React: kit.React, ReactDOM: kit.ReactDOM, ReactJSX: jsxRuntime, SVGIcons: {}, URI: kit.URI,
    Player: {
      get data() {
        return player.state ?? { item: player.track ?? undefined, isPaused: !player.isPlaying };
      },
      get origin() { return { _state: player.state }; },
      getProgress: () => player.position,
      getRepeat: () => ["off", "context", "track"].indexOf(player.repeat),
      getVolume: () => player.volume,
      getHeart: () => player.liked,
      isPlaying: () => player.isPlaying,
      addEventListener(event: string, callback: (event: unknown) => void) {
        const name = event === "songchange" ? "track" : "playpause";
        listeners.set(callback, player.on(name, (state) => callback({ data: state ?? provider.Player.data })));
      },
      removeEventListener(_event: string, callback: (event: unknown) => void) {
        listeners.get(callback)?.();
        listeners.delete(callback);
      },
    },
  };
  return provider;
}

function makeBackground(host: ProviderHost) {
  const lifetime = new AbortController();
  const frame = document.createElement("iframe");
  frame.title = "Spicy Lyrics provider";
  frame.inert = true;
  frame.tabIndex = -1;
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;top:0;left:0;width:8px;height:8px;border:0;opacity:0;pointer-events:none";
  document.body.append(frame);

  const subscriptions = new Map<string, Set<(event: unknown) => void>>();
  function stop() {
    lifetime.abort();
    for (const [event, callbacks] of subscriptions) {
      for (const callback of callbacks) host.Player.removeEventListener(event, callback);
    }
    subscriptions.clear();
    if (ownProviderFrame === frame.contentWindow) ownProviderFrame = undefined;
    frame.remove();
  }

  const doc = frame.contentDocument;
  const sandbox = frame.contentWindow as (Window & {
    Spicetify?: Record<string, unknown>;
    _spicy_lyrics_metadata?: { LoadedVersion: string };
  }) | null;
  if (!doc || !sandbox) {
    stop();
    throw new Error("Spicy Lyrics provider document unavailable");
  }
  ownProviderFrame = sandbox;

  const base = doc.createElement("base");
  base.href = location.origin + "/";
  doc.head.append(base);
  const main = doc.createElement("main");
  main.id = "main-view";
  const container = doc.createElement("div");
  container.className = "main-view-container";
  const viewport = doc.createElement("div");
  viewport.setAttribute("data-overlayscrollbars-viewport", "");
  container.append(viewport);
  main.append(container);
  doc.body.append(main);

  const noop = () => {};
  const store = new Map([["SL:settings", JSON.stringify({
    backgroundStyle: "none", skipSpicyFont: true, disableNpvLyrics: true,
    showNpvDynamicBg: false, showNoLyricsNotice: false, popupLyricsAllowed: false,
  })]]);
  const player = host.Player;
  // The official plugin opens its lyrics page only on this route.
  const history = { location: { pathname: "/SpicyLyrics" }, listen: () => noop, push: noop, goBack: noop };
  const tooltip = { setContent: noop, setProps: noop, destroy: noop };
  const noButton = class {
    element = doc!.createElement("button");
    tippy = tooltip;
    register() {}
    deregister() {}
  };
  sandbox.Spicetify = {
    ...host,
    get CosmosAsync() { return host.CosmosAsync; },
    Platform: new Proxy({}, {
      get(_, key) {
        if (key === "History") return history;
        if (key === "PlaybackAPI") return {};
        return host.Platform && Reflect.get(host.Platform, key, host.Platform);
      },
    }),
    Player: {
      get data() { return player.data; },
      get origin() { return { _state: player.origin?._state ?? {} }; },
      getProgress: () => player.getProgress(),
      getRepeat: () => player.getRepeat?.() ?? 0,
      getVolume: () => player.getVolume?.() ?? 0,
      getHeart: () => player.getHeart?.() ?? false,
      isPlaying: () => player.isPlaying(),
      addEventListener(event: string, callback: (event: unknown) => void) {
        if (event !== "songchange" && event !== "onplaypause") return;
        const callbacks = subscriptions.get(event) ?? new Set();
        if (callbacks.has(callback)) return;
        subscriptions.set(event, callbacks);
        callbacks.add(callback);
        player.addEventListener(event, callback);
      },
      removeEventListener(event: string, callback: (event: unknown) => void) {
        if (subscriptions.get(event)?.delete(callback)) player.removeEventListener(event, callback);
      },
    } satisfies Partial<Spicetify["Player"]>,
    LocalStorage: {
      get: (key: string) => store.get(key) ?? null,
      set: (key: string, value: string) => store.set(key, value),
      remove: (key: string) => store.delete(key),
    },
    Menu: { Item: noButton }, Topbar: { Button: noButton }, Playbar: { Button: noButton, Widget: noButton },
    Keyboard: { KEYS: (host as { Keyboard?: { KEYS?: object } }).Keyboard?.KEYS ?? {}, registerImportantShortcut: noop },
    PopupModal: { display: noop, hide: noop },
    Tippy: () => tooltip,
    showNotification: noop,
  };
  return { doc, sandbox, stop, signal: lifetime.signal };
}

function mountProvider(doc: Document, signal: AbortSignal) {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(12_000)]);
  return new Promise<void>((resolve, reject) => {
    const script = doc.createElement("script");
    script.type = "module";
    script.src = api + "grabPluginFile";
    const observer = new MutationObserver(() => {
      if (doc.querySelector("#SpicyLyricsPage .LyricsContent")) finish();
    });
    const onError = () => finish(new Error("Could not load the Spicy Lyrics provider module"));
    const onAbort = () => finish(deadline.reason);
    function finish(error?: unknown) {
      observer.disconnect();
      script.removeEventListener("error", onError);
      deadline.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve();
    }
    deadline.throwIfAborted();
    observer.observe(doc.body, { childList: true, subtree: true });
    deadline.addEventListener("abort", onAbort, { once: true });
    script.addEventListener("error", onError, { once: true });
    doc.head.append(script);
  });
}

export function startSpicyProvider() {
  const controller = new AbortController();
  let background: ReturnType<typeof makeBackground> | undefined;
  let pending = false;
  let retryAt = 0;

  async function reconcile() {
    if (externalProviderAvailable()) {
      background?.stop();
      background = undefined;
      return;
    }
    if (controller.signal.aborted || pending || background || Date.now() < retryAt) return;
    const spice = spicetify();
    const host = spice?.CosmosAsync && spice.Platform ? spice : nativeProviderHost();
    if (!host?.Player || !host.Platform || !host.CosmosAsync) return;
    pending = true;
    retryAt = Date.now() + 30_000;
    try {
      const response = await fetch(api + "grabClientInfo", {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8_000)]),
      });
      if (!response.ok) throw new Error(`Provider metadata HTTP ${response.status}`);
      const info = await response.json() as { branches?: { tag: string; version: string }[] };
      const version = info.branches?.find((branch) => branch.tag === "public")?.version;
      if (!version) throw new Error("Spicy Lyrics public version unavailable");
      if (controller.signal.aborted || externalProviderAvailable()) return;
      const instance = background = makeBackground(host);
      instance.sandbox._spicy_lyrics_metadata = { LoadedVersion: version };
      await mountProvider(instance.doc, instance.signal);
    } catch (error) {
      background?.stop();
      background = undefined;
      if (!controller.signal.aborted && !externalProviderAvailable())
        console.warn("[Lyssna Lyrics] Spicy Lyrics provider unavailable", error);
    } finally {
      pending = false;
    }
  }

  const initial = window.setTimeout(reconcile, 2_000);
  const timer = window.setInterval(reconcile, 3_000);
  return () => {
    controller.abort();
    clearTimeout(initial);
    clearInterval(timer);
    background?.stop();
  };
}

type Vocal = {
  Text?: string;
  StartTime?: number;
  EndTime?: number;
  TranslatedText?: string;
  TransliteratedText?: string;
  Syllables?: (Vocal & { IsPartOfWord?: boolean })[];
};
type VocalEntry = Vocal & { Type?: string; Lead?: Vocal; Background?: Vocal[]; OppositeAligned?: boolean };
type Payload = Vocal & {
  uri?: string;
  source?: string;
  Type?: string;
  Lines?: VocalEntry[];
  Content?: VocalEntry[];
  SongWriters?: (string | { name?: string })[];
  Songwriters?: (string | { name?: string })[];
  UploadAttribution?: { Uploader?: unknown; Maker?: unknown };
  TTMLUploadMetadata?: { Uploader?: unknown; Maker?: unknown };
};

function contributor(value: unknown): Contributor | undefined {
  if (!value || typeof value !== "object") return;
  const person = value as Record<string, unknown>;
  const firstText = (...keys: string[]) => keys.map((key) => person[key]).find((item): item is string => typeof item === "string" && !!item.trim())?.trim();
  const id = firstText("id", "userId", "user_id") ?? "";
  const discord = firstText("discord", "discordUsername", "discord_username", "username");
  const username = firstText("displayName", "display_name", "global_name", "globalName", "username", "name") ?? (id || undefined);
  if (!username) return;
  const profile = firstText("url", "profileUrl", "profile_url");
  const url = profile && /^https:\/\/spicylyrics\.org\//i.test(profile) ? profile
    : /^\d+$/.test(id) ? `https://spicylyrics.org/uid/${id}` : undefined;
  const image = firstText("avatar_url", "avatarUrl", "avatar");
  const avatar = image?.startsWith("https://") ? image : image && /^\d+$/.test(id) && /^(?:a_)?[a-f0-9]+$/i.test(image)
    ? `https://cdn.discordapp.com/avatars/${id}/${image}.webp?size=64` : undefined;
  return { id, username, discord, url, avatar };
}

function normalize(data: Payload): Lyrics | undefined {
  const sourceId = typeof data.source === "string" ? data.source.trim().toLowerCase() : "";
  const tokens = sourceId.split(/[^a-z0-9]+/);
  const source = sourceId === "apple_music" || (tokens.includes("aml") && !tokens.includes("spl")) ? "Apple Music" : "Spicy Lyrics";
  const attribution = {
    maker: contributor(data.UploadAttribution?.Maker) ?? contributor(data.TTMLUploadMetadata?.Maker),
    uploader: contributor(data.UploadAttribution?.Uploader) ?? contributor(data.TTMLUploadMetadata?.Uploader),
  };
  if (data.Type === "Instrumental") return { source, attribution, lines: [], synced: false, instrumental: true };
  const lines: Line[] = [];
  const timed = data.Type === "Syllable" || data.Type === "Line";
  const ms = (time = 0) => Number.isFinite(time) ? Math.max(0, Math.round(time * 1000)) : 0;

  function add(vocal: Vocal, entry: VocalEntry, background = false) {
    const syllables = vocal.Syllables ?? [];
    const start = vocal.StartTime ?? entry.StartTime ?? 0;
    const end = vocal.EndTime ?? entry.EndTime ?? start;
    const words: Word[] = syllables.map((part, index) => {
      const space = index && !syllables[index - 1].IsPartOfWord ? " " : "";
      return {
        text: space + (part.Text ?? ""), romanization: part.TransliteratedText ? space + part.TransliteratedText : undefined,
        start_ms: ms(part.StartTime ?? start), end_ms: ms(part.EndTime ?? end),
      };
    });
    const text = words.length ? words.map((word) => word.text).join("") : (vocal.Text || entry.Text || "");
    if (!text.trim()) return;
    lines.push({
      text, words, background, opposite: !!entry.OppositeAligned, translation: vocal.TranslatedText ?? "", romanization: vocal.TransliteratedText ?? "",
      start_ms: words[0]?.start_ms ?? ms(start),
      end_ms: words.at(-1)?.end_ms ?? ms(end),
    });
  }

  const entries = data.Content ?? data.Lines ?? [];
  const start = (entry: VocalEntry) => entry.StartTime ?? entry.Lead?.StartTime ?? 0;
  for (const entry of timed ? entries.toSorted((left, right) => start(left) - start(right)) : entries) {
    if (entry.Type === "Interlude") continue;
    add(entry.Lead ?? entry, entry);
    for (const vocal of entry.Background ?? []) add(vocal, entry, true);
  }
  if (lines.length) return {
    source, lines, synced: timed, instrumental: false,
    songwriters: (data.SongWriters ?? data.Songwriters)?.flatMap((writer) => typeof writer === "string" ? [writer] : (writer?.name ? [writer.name] : [])),
    attribution,
  };
}

export async function readSpicyLyrics(trackId: string) {
  const uri = `spotify:track:${trackId}`;
  const current = window as ProviderWindow;
  const background = ownProviderFrame ?? current.__LYSSNA_SPICY_BACKGROUND__?.frameWindow;
  let timeout: number | undefined;
  try {
    const provider = (background ?? current) as ProviderWindow;
    const manager = provider.SpicyLyrics?.db?.objectStores?.lyricsStore?.manager;
    const local = manager && await Promise.race([
      manager.get(uri), new Promise<undefined>((resolve) => { timeout = window.setTimeout(resolve, 650); }),
    ]) as Payload | null | undefined;
    if (local && (!local.uri || local.uri === uri)) {
      const lyrics = normalize(local);
      if (lyrics) return lyrics;
    }
  } catch { /* The cached lyrics are still available while the provider starts. */ }
  finally { window.clearTimeout(timeout); }
  const response = await caches.match(`/${trackId}`, { cacheName });
  if (!response) return;
  const record = await response.json() as { Content?: Payload; ExpiresAt?: number };
  const data = record.Content;
  if (data && (!data.uri || data.uri === uri) && (record.ExpiresAt ?? 0) > Date.now()) return normalize(data);
}
