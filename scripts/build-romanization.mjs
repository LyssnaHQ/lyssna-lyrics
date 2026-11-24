import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const crate = "crates/lyric-romanize";
const target = "wasm32-unknown-unknown";
execFileSync("cargo", ["build", "--locked", "--manifest-path", `${crate}/Cargo.toml`, "--target", target, "--release"], {
  stdio: "inherit",
});
const module = readFileSync(`${crate}/target/${target}/release/lyric_romanize.wasm`);
const engine = new WebAssembly.Module(module);
if (WebAssembly.Module.imports(engine).length) throw new Error("Romanization WASM needs host imports");
const exports = WebAssembly.Module.exports(engine);
for (const name of ["memory", "prepare_input", "romanize", "output_ptr"]) {
  if (!exports.some((item) => item.name === name)) throw new Error(`Missing romanization WASM export ${name}`);
}

const gzip = gzipSync(module, { level: 9 });
const sha256 = createHash("sha256").update(gzip).digest("hex");
const path = `assets/romanization/lyric-romanize-${sha256.slice(0, 12)}.wasm.gz`;
mkdirSync("assets/romanization", { recursive: true });
writeFileSync(path, gzip);
writeFileSync("src/lyssna/romanization-asset.json", JSON.stringify({ path, sha256 }, null, 2) + "\n");
console.log(`Built ${path} (${gzip.length} bytes)`);
