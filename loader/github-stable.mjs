const repository = "LyssnaHQ/lyssna-lyrics";
const releaseApi = `https://api.github.com/repos/${repository}/releases/latest`;

export async function readStableRelease(signal) {
  const response = await fetch(releaseApi, {
    credentials: "omit", cache: "no-cache", headers: { Accept: "application/vnd.github+json" },
    signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub Stable release HTTP ${response.status}`);
  const release = await response.json();
  const tag = release?.tag_name;
  if (typeof tag !== "string" || !/^v?\d+\.\d+\.\d+$/.test(tag) || release.draft || release.prerelease) return null;
  const version = tag.replace(/^v/, "");
  const filename = `lyssna-lyrics@${version}.mjs`;
  const asset = Array.isArray(release.assets) && release.assets.find((item) => item.name === filename);
  if (typeof asset?.digest !== "string" || !/^sha256:[a-f0-9]{64}$/i.test(asset.digest)) return null;
  const url = `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(filename)}`;
  return { version, url, digest: asset.digest.toLowerCase() };
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
