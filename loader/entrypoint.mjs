import { importBundle, importStableRelease, readStableRelease } from "./github-stable.mjs";

const website = new URL("https://ipixelgalaxy.com/lyssna-plugin/");
const repository = "https://raw.githubusercontent.com/LyssnaHQ/lyssna-lyrics/refs/heads/master/";
const channelKey = "lyssna-lyrics.v1.channel";
const hiddenKey = "lyssna-lyrics.v1.hidden-build";
const names = ["stable", "beta", "canary"];
const versionPattern = /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/;
const keyPattern = /^[A-Za-z0-9_-]{32}$/;

async function ready(signal) {
  if (globalThis.SpotiKit) {
    await globalThis.SpotiKit.ready;
    signal.throwIfAborted();
    return;
  }
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    const spice = globalThis.Spicetify;
    if (spice?.React && spice.ReactDOM && spice.Player && spice.Playbar?.Button && spice.Platform?.History?.listen) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Spicetify did not become ready");
}

function showLoading() {
  const label = "Loading Lyssna Lyrics";
  const icon = '<svg class="lyssna-rewrite-loader-spinner" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9" opacity=".25"/><path d="M12 3a9 9 0 0 1 9 9" stroke-linecap="round"/></svg>';
  const kit = globalThis.SpotiKit;
  const spice = globalThis.Spicetify;
  let element, remove;
  if (kit) {
    const button = (kit.Playbar ?? kit.Topbar).add({ label, icon, onClick() {} });
    element = button.element;
    remove = () => button.remove();
  } else if (spice?.Playbar?.Button) {
    const button = new spice.Playbar.Button(label, icon, () => {}, true, false, false);
    element = button.element;
    button.register();
    remove = () => button.deregister();
  } else return () => {};
  element?.setAttribute("aria-label", label);
  element?.setAttribute("aria-busy", "true");
  element?.setAttribute("aria-disabled", "true");
  element?.classList.add("lyssna-rewrite-loader-button");
  const style = document.createElement("style");
  style.textContent = `
    [data-lyssna-playbar-lyrics] { display: none !important; }
    .lyssna-rewrite-loader-button { display: inline-flex !important; align-items: center; justify-content: center; opacity: 1 !important; cursor: progress; }
    .lyssna-rewrite-loader-spinner { width: 20px; height: 20px; flex: 0 0 auto; animation: lyssna-rewrite-loader-spin .9s linear infinite; }
    @keyframes lyssna-rewrite-loader-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .lyssna-rewrite-loader-spinner { animation: none; } }
  `;
  document.head.append(style);
  return () => {
    style.remove();
    remove();
  };
}

async function hiddenRelease(key, signal) {
  if (!keyPattern.test(key)) throw new Error("Enter the 32-character build key.");
  const folder = new URL(`builds/hidden/${key}/`, website);
  let release;
  try {
    const response = await fetch(new URL("release.json", folder), {
      cache: "no-store", redirect: "error", referrerPolicy: "no-referrer",
      signal: AbortSignal.any([signal, AbortSignal.timeout(8_000)]),
    });
    if (response.ok) release = await response.json();
  } catch {
    signal.throwIfAborted();
    throw new Error("Couldn’t reach the hidden build. Try again.");
  }
  if (release?.protocol !== 1 || typeof release.version !== "string" || !versionPattern.test(release.version)) {
    throw new Error("No hidden build matches that key.");
  }
  return { version: release.version, url: new URL(`lyssna-lyrics@${release.version}.mjs`, folder) };
}

async function readChannels(signal) {
  const response = await fetch(new URL("loader/channels.json", repository), {
    cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(8_000)]),
  });
  if (!response.ok) throw new Error(`Build channels HTTP ${response.status}`);
  const catalog = await response.json();
  if (catalog?.protocol !== 1) throw new Error("Unrecognized build channel manifest");
  const stable = await readStableRelease(signal, catalog);
  const channels = { stable: stable?.version ?? null, ...Object.fromEntries(["beta", "canary"].map((name) => {
    const version = catalog.channels?.[name];
    return [name, typeof version === "string" && versionPattern.test(version) ? version : null];
  })) };
  return { lyssnaSignIn: catalog.lyssnaSignIn === true, channels, stable };
}

async function importWebsiteBuild(url, signal) {
  const response = await fetch(url, {
    cache: "no-cache", credentials: "omit", signal: AbortSignal.any([signal, AbortSignal.timeout(8_000)]),
  });
  if (!response.ok) throw new Error(`Test build HTTP ${response.status}`);
  return importBundle(await response.arrayBuffer(), signal);
}

export async function start(signal) {
  await ready(signal);
  let stopLoading;
  const timer = setTimeout(() => { stopLoading = showLoading(); }, 400);
  try {
    return await startBuild(signal);
  } finally {
    clearTimeout(timer);
    stopLoading?.();
  }
}

async function startBuild(signal) {
  const { lyssnaSignIn, channels, stable } = await readChannels(signal);
  const saved = localStorage.getItem(channelKey);
  const selected = names.includes(saved) && channels[saved] ? saved : names.find((name) => channels[name]);
  if (!selected) throw new Error("No Lyssna builds are published yet");
  const savedHiddenKey = localStorage.getItem(hiddenKey);

  async function selectHiddenBuild(key) {
    await hiddenRelease(key, signal);
    signal.throwIfAborted();
    localStorage.setItem(hiddenKey, key);
    location.reload();
  }

  function clearHiddenBuild() {
    localStorage.removeItem(hiddenKey);
    location.reload();
  }

  async function selectChannel(channel) {
    if (!names.includes(channel) || !channels[channel] || switching) return;
    if (savedHiddenKey) {
      localStorage.setItem(channelKey, channel);
      clearHiddenBuild();
    } else {
      await load(channel, true);
    }
  }

  let current;
  let switching = false;
  function stop() {
    current?.dispose();
    current = undefined;
  }
  signal.addEventListener("abort", stop, { once: true });

  async function load(channel, reopen, hidden) {
    switching = true;
    try {
      let build;
      const importPublic = (name) => name === "stable" ? importStableRelease(stable, signal)
        : importWebsiteBuild(new URL(`builds/lyssna-lyrics@${channels[name]}.mjs`, website), signal);
      if (hidden) build = await importWebsiteBuild(hidden.url, signal);
      else {
        try {
          build = await importPublic(channel);
        } catch (error) {
          signal.throwIfAborted();
          const fallback = !reopen && names.find((name) => name !== channel && channels[name]);
          if (!fallback) throw error;
          console.warn(`[Lyssna Lyrics] ${channel} unavailable. Loading ${fallback}.`, error);
          build = await importPublic(fallback);
          channel = fallback;
        }
      }
      signal.throwIfAborted();
      const next = build.default({
        channel, channels, selectChannel, lyssnaSignIn,
        hiddenVersion: hidden?.version, selectHiddenBuild,
        clearHiddenBuild: savedHiddenKey ? clearHiddenBuild : undefined,
        patchNotesUrl: new URL(".change_notes/PATCH_NOTES.md", repository).href,
        latestVersion: async (checkSignal) => (await readChannels(AbortSignal.any([signal, checkSignal]))).channels[channel],
        showLoading,
      });
      stop();
      current = next;
      if (reopen) {
        localStorage.setItem(channelKey, channel);
        current.open();
      }
    } finally {
      switching = false;
    }
  }

  try {
    if (savedHiddenKey) {
      try {
        await load(selected, false, await hiddenRelease(savedHiddenKey, signal));
      } catch {
        signal.throwIfAborted();
        console.warn("[Lyssna Lyrics] Hidden build unavailable. Loading the public channel.");
      }
    }
    if (!current) await load(selected, false);
  } catch (error) {
    signal.removeEventListener("abort", stop);
    stop();
    throw error;
  }
  return () => {
    signal.removeEventListener("abort", stop);
    stop();
  };
}
