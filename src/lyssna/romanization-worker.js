let engine;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function loadEngine({ path, sha256 }) {
  const repo = "LyssnaHQ/lyssna-lyrics";
  const locations = [
    `https://cdn.jsdelivr.net/gh/${repo}@master/${path}`,
    `https://cdn.jsdelivr.net/gh/${repo}@canary/${path}`,
    `https://raw.githubusercontent.com/${repo}/master/${path}`,
    `https://raw.githubusercontent.com/${repo}/canary/${path}`,
  ];
  let lastError;
  for (const location of locations) {
    try {
      const response = await fetch(location, { credentials: "omit", signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(`Romanization engine HTTP ${response.status}`);
      const bytes = await response.arrayBuffer();
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
      if (Array.from(digest, value => value.toString(16).padStart(2, "0")).join("") !== sha256) {
        throw new Error("Romanization engine integrity check failed");
      }
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
      const { instance } = await WebAssembly.instantiateStreaming(
        new Response(stream, { headers: { "Content-Type": "application/wasm" } }),
      );
      return instance.exports;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

self.onmessage = async ({ data: { id, asset, request } }) => {
  try {
    const wasm = await (engine ??= loadEngine(asset));
    const input = encoder.encode(JSON.stringify(request));
    const offset = wasm.prepare_input(input.length);
    new Uint8Array(wasm.memory.buffer, offset, input.length).set(input);
    const length = wasm.romanize();
    if (!length) throw new Error("Romanization engine rejected the lyrics");
    const result = decoder.decode(new Uint8Array(wasm.memory.buffer, wasm.output_ptr(), length));
    self.postMessage({ id, lines: JSON.parse(result) });
  } catch {
    self.postMessage({ id, lines: null });
  }
};
