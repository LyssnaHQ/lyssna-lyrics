const repository = "LyssnaHQ/lyssna-lyrics";
export async function readStableRelease(signal, catalog) {
  // Older cached entrypoints call this without a catalog.
  if (!catalog) {
    const response = await fetch(`https://raw.githubusercontent.com/${repository}/master/loader/channels.json`, {
      credentials: "omit", cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(8_000)]),
    });
    if (!response.ok) throw new Error(`Build channels HTTP ${response.status}`);
    catalog = await response.json();
  }
  const { tag, digest } = catalog?.stableRelease ?? {};
  if (catalog?.protocol !== 1 || typeof tag !== "string" || !/^v?\d+\.\d+\.\d+$/.test(tag) ||
    typeof digest !== "string" || !/^sha256:[a-f0-9]{64}$/i.test(digest)) return null;
  const version = tag.replace(/^v/, "");
  const filename = `lyssna-lyrics@${version}.mjs`;
  const url = `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(filename)}`;
  return { version, url, digest: digest.toLowerCase() };
}

export async function importStableRelease(release, signal) {
  // GitHub's download redirects lack CORS headers. Authenticate the relayed bytes against GitHub's asset digest.
  const response = await fetch(`https://cors-proxy.spicetify.app/${release.url}`, {
    credentials: "omit", signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
  });
  if (!response.ok) throw new Error(`GitHub Stable asset HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  if (!bytes.byteLength) throw new Error("GitHub Stable asset is empty");
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (`sha256:${hex}` !== release.digest) throw new Error("GitHub Stable asset checksum mismatch");
  return importBundle(bytes, signal);
}

export async function importBundle(bytes, signal) {
  signal.throwIfAborted();
  const url = URL.createObjectURL(new Blob([bytes], { type: "text/javascript" }));
  try {
    const bundle = await import(url);
    if (typeof bundle.default !== "function") throw new Error("Release has no plugin entrypoint");
    return bundle;
  }
  finally { URL.revokeObjectURL(url); }
}
