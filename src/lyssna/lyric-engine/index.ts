import * as bindings from "./lyric_engine.js";
import { WASM } from "./wasm";

// Lyssna Desktop's lyric engine at 679211d. Spotify's extension hosts can
// deny WebAssembly, so the existing JavaScript path remains available.
export const lyricEngine = (() => {
  try {
    bindings.initSync({ module: Uint8Array.from(atob(WASM), character => character.charCodeAt(0)) });
    return bindings;
  } catch { return undefined; }
})();
