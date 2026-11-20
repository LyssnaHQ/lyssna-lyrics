import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "vite";

const [mode, hiddenVersion, ...extra] = process.argv.slice(2);
if (extra.length || (mode !== undefined && !["--test", "--hidden"].includes(mode)) ||
  (hiddenVersion !== undefined && mode !== "--hidden")) {
  throw new Error("Usage: npm run build [-- --test | --hidden [version]]");
}

const testBuild = mode === "--test";
const hiddenBuild = mode === "--hidden";
const { version: packageVersion } = JSON.parse(readFileSync("package.json", "utf8"));
const version = hiddenVersion ?? packageVersion;
if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version)) {
  throw new Error("Expected a build version like 7.2.7.");
}
const filename = `lyssna-lyrics@${version}.mjs`;
const output = "dist";
const host = testBuild || hiddenBuild ? "Y:/website/lyssna-plugin" : output;
const entrypoint = join(host, "rewrite", "v1.0");
const channelsFile = join(entrypoint, "channels.json");

function write(target, content) {
  const temp = `${target}.${process.pid}.tmp`;
  writeFileSync(temp, content, { flag: "wx" });
  renameSync(temp, target);
}

function copy(source, target) {
  write(target, readFileSync(source));
}

execFileSync(process.execPath, ["node_modules/typescript/bin/tsc"], { stdio: "inherit" });
await build({ build: { outDir: join(output, "bundle") } });

const payload = join(output, "bundle", "plugin.mjs");
const notices = readFileSync("THIRD_PARTY_NOTICES.md", "utf8");
const licenses = ["lucide-react/LICENSE", "@kawarp/core/LICENSE", "transliteration/LICENSE.txt",
  "compromise/LICENSE", "compromise-speech/LICENSE", "efrt/LICENSE", "suffix-thumb/LICENSE"]
  .map((path) => readFileSync(join("node_modules", path), "utf8").trim());
for (const path of ["src/fonts/Inter-OFL.txt", "src/fonts/Metropolis-Unlicense.txt", "src/fonts/Adobe-Blank-OFL.txt"]) {
  licenses.push(readFileSync(path, "utf8").trim());
}
// Use line comments so a third-party notice can contain a literal block-comment terminator.
const header = [notices.trim(), ...licenses].join("\n\n").split(/\r?\n/).map((line) => `// ${line}`).join("\n");
const bundle = `${header}\n${readFileSync(payload, "utf8")}`;
if (hiddenBuild) {
  const key = randomBytes(24).toString("base64url");
  const folder = join(host, "builds", "hidden", key);
  mkdirSync(folder, { recursive: true });
  write(join(folder, filename), bundle);
  write(join(folder, "release.json"), JSON.stringify({ protocol: 1, version }) + "\n");
  console.log(`Hidden build ${version} access key: ${key}`);
} else {
  const channels = existsSync(channelsFile)
    ? JSON.parse(readFileSync(channelsFile, "utf8"))
    : { protocol: 1, channels: { beta: null, canary: null } };
  if (channels.protocol !== 1 || !channels.channels) throw new Error(`Invalid manifest at ${channelsFile}`);
  delete channels.channels.stable;
  channels.channels.canary = version;

  mkdirSync(join(output, "spotikit"), { recursive: true });
  mkdirSync(join(host, "builds"), { recursive: true });
  mkdirSync(entrypoint, { recursive: true });
  copyFileSync("loader/lyssna-lyrics.mjs", join(output, "spotikit", "extension.js"));
  copyFileSync("loader/spotikit.json", join(output, "spotikit", "spotikit.json"));
  write(join(host, "builds", filename), bundle);
  copy(join(".change_notes", "PATCH_NOTES.md"), join(entrypoint, "patch-notes.md"));
  copy("loader/github-stable.mjs", join(entrypoint, "github-stable.mjs"));
  copy("loader/entrypoint.mjs", join(entrypoint, "entrypoint.mjs"));
  copy("loader/lyssna-lyrics.mjs", join(host, "rewrite", "lyssna-lyrics.mjs"));
  write(channelsFile, JSON.stringify(channels, null, 2) + "\n");
  console.log(`Canary ${version} built to ${join(host, "builds", filename)}`);
}
