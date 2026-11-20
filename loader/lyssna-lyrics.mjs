const entrypoint = "https://cdn.jsdelivr.net/gh/LyssnaHQ/lyssna-lyrics@master/loader/entrypoint.mjs";

export default async function start(context) {
  const signal = context?.signal ?? new AbortController().signal;
  try {
    const entry = await import(entrypoint);
    if (!signal.aborted) return await entry.start(signal);
  } catch (error) {
    if (!signal.aborted) console.error("[Lyssna Lyrics] Could not start", error);
  }
}

if (!globalThis.SpotiKit) void start();
