const repository = "LyssnaHQ/lyssna-lyrics";
const catalogUrl = `https://raw.githubusercontent.com/${repository}/refs/heads/master/loader/channels.json`;

export default async function start(context) {
  const signal = context?.signal ?? new AbortController().signal;
  try {
    const response = await fetch(`${catalogUrl}?t=${Date.now()}`, {
      cache: "no-store", credentials: "omit", signal: AbortSignal.any([signal, AbortSignal.timeout(8_000)]),
    });
    if (!response.ok) throw new Error(`Build channels HTTP ${response.status}`);
    const catalog = await response.json();
    const tag = catalog?.stableRelease?.tag;
    if (catalog?.protocol !== 1 || typeof tag !== "string" || !/^v?\d+\.\d+\.\d+$/.test(tag)) {
      throw new Error("Unrecognized Stable release");
    }
    // The 1.0.0 entrypoint expects a manifest beside itself, which that tag never shipped.
    const entryTag = /^v?1\.0\.0$/.test(tag) ? "v1.1.0" : tag;
    const entry = await import(`https://cdn.jsdelivr.net/gh/${repository}@${entryTag}/loader/entrypoint.mjs`);
    if (!signal.aborted) return await entry.start(signal, catalog);
  } catch (error) {
    if (!signal.aborted) console.error("[Lyssna Lyrics] Could not start", error);
  }
}

if (!globalThis.SpotiKit) void start();
