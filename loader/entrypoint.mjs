const root = new URL("../../", import.meta.url);
const channelKey = "lyssna-lyrics.v1.channel";
const names = ["stable", "beta", "canary"];
const versionPattern = /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/;

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

  let current;
  let switching = false;
  function stop() {
    current?.dispose();
    current = undefined;
  }
  signal.addEventListener("abort", stop, { once: true });

  async function load(channel, reopen) {
    if (!names.includes(channel) || !channels[channel] || switching) return;
    switching = true;
    try {
      const url = new URL(`builds/lyssna-lyrics@${channels[channel]}.mjs`, root);
      const build = await import(url.href);
      signal.throwIfAborted();
      const next = build.default({ channel, channels, lyssnaSignIn: catalog.lyssnaSignIn === true, selectChannel: (name) => load(name, true) });
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
    await load(selected, false);
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
