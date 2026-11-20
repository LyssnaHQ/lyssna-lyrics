const root = new URL("../../", import.meta.url);
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

async function hiddenRelease(key, signal) {
  if (!keyPattern.test(key)) throw new Error("Enter the 32-character build key.");
  const folder = new URL(`builds/hidden/${key}/`, root);
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

export async function start(signal) {
  await ready(signal);
  const response = await fetch(new URL("channels.json", import.meta.url), {
    cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(8_000)]),
  });
  if (!response.ok) throw new Error(`Build channels HTTP ${response.status}`);
  const catalog = await response.json();
  if (catalog?.protocol !== 1) throw new Error("Unrecognized build channel manifest");
  const channels = Object.fromEntries(names.map((name) => {
    const version = catalog.channels?.[name];
    return [name, typeof version === "string" && versionPattern.test(version) ? version : null];
  }));

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
      const url = hidden?.url ?? new URL(`builds/lyssna-lyrics@${channels[channel]}.mjs`, root);
      const build = await import(url.href);
      signal.throwIfAborted();
      const next = build.default({
        channel, channels, selectChannel, lyssnaSignIn: catalog.lyssnaSignIn === true,
        hiddenVersion: hidden?.version, selectHiddenBuild,
        clearHiddenBuild: savedHiddenKey ? clearHiddenBuild : undefined,
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
