import { spicetify, spotikit, type Spicetify } from "./host";
import * as jsxRuntime from "./host-jsx";
import type { Contributor, Line, Lyrics, Word } from "./lyssna/types";

const api = "https://api.spicylyrics.org/bp/loader/";
const cacheName = "SpicyLyrics_LyricsStore_g1";
const spicyName = /spicy[\W_]*lyrics/i;

function standaloneInstalled() {
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
  const frame = document.createElement("iframe");
  frame.title = "Spicy Lyrics provider";
  frame.inert = true;
  frame.tabIndex = -1;
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;top:0;left:0;width:8px;height:8px;border:0;opacity:0;pointer-events:none";
  document.body.append(frame);

  const subscriptions = new Map<string, Set<(event: unknown) => void>>();
  function stop() {
    for (const [event, callbacks] of subscriptions) {
      for (const callback of callbacks) host.Player.removeEventListener(event, callback);
    }
    subscriptions.clear();
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
  const history = { location: { pathname: "/" }, listen: () => noop, push: noop, goBack: noop };
  const noButton = class {
    element = doc!.createElement("button");
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
    Keyboard: { ...(host as { Keyboard?: object }).Keyboard, registerImportantShortcut: noop },
    PopupModal: { display: noop, hide: noop },
    Tippy: () => ({ setContent: noop, setProps: noop, destroy: noop }),
    showNotification: noop,
  };
  return { doc, sandbox, stop };
}

export function startSpicyProvider() {
  const controller = new AbortController();
  let background: ReturnType<typeof makeBackground> | undefined;
  let pending = false;
  let retryAt = 0;

  async function reconcile() {
    if (standaloneInstalled()) {
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
      if (controller.signal.aborted || standaloneInstalled()) return;
      const instance = background = makeBackground(host);
      instance.sandbox._spicy_lyrics_metadata = { LoadedVersion: version };
      const script = instance.doc.createElement("script");
      script.type = "module";
      script.src = api + "grabPluginFile";
      script.addEventListener("error", () => {
        if (background !== instance) return;
        instance.stop();
        background = undefined;
        console.warn("[Lyssna Lyrics] Could not load the Spicy Lyrics provider");
      }, { once: true });
      instance.doc.head.append(script);
    } catch (error) {
      if (!controller.signal.aborted) console.warn("[Lyssna Lyrics] Spicy Lyrics provider unavailable", error);
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
  Type?: string;
  Lines?: VocalEntry[];
  Content?: VocalEntry[];
  SongWriters?: (string | { name?: string })[];
  UploadAttribution?: { Uploader?: Contributor; Maker?: Contributor };
};

function normalize(data: Payload): Lyrics | undefined {
  if (data.Type === "Instrumental") return { source: "Spicy Lyrics", lines: [], synced: false, instrumental: true };
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
    source: "Spicy Lyrics", lines, synced: timed, instrumental: false,
    songwriters: data.SongWriters?.flatMap((writer) => typeof writer === "string" ? [writer] : (writer?.name ? [writer.name] : [])),
    attribution: { maker: data.UploadAttribution?.Maker, uploader: data.UploadAttribution?.Uploader },
  };
}

export async function readSpicyLyrics(trackId: string) {
  const response = await caches.match(`/${trackId}`, { cacheName });
  if (!response) return;
  const record = await response.json() as { Content?: Payload; ExpiresAt?: number };
  if (record.Content && (record.ExpiresAt ?? 0) > Date.now()) return normalize(record.Content);
}
