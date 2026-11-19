import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const app = resolve(process.argv[2] ?? "../lyssna-app");
const git = (...args) => execFileSync("git", ["-C", app, ...args], {
  encoding: "utf8",
  maxBuffer: 8 * 1024 * 1024,
});
const commit = git("rev-parse", `${process.argv[3] ?? "HEAD"}^{commit}`).trim();
const read = (file) => git("show", `${commit}:${file}`);
const write = (file, content) => writeFileSync(`src/lyssna/${file}`, content);

function slice(source, first, after) {
  const start = source.indexOf(first);
  const end = source.indexOf(after, start + first.length);
  if (start < 0 || end < 0) throw new Error(`Could not find upstream section ${first}`);
  return source.slice(start, end).trimEnd();
}

const files = ["animator-tuning.ts", "frame-cap.ts", "lyric-animator.ts", "lyric-motion.ts", "lyric-word.tsx"];
const styles = read("frontend/styles.css");
const types = slice(read("frontend/types.ts"), "export interface Word {", "export interface PlayingDetails {");
const lyrics = [
  slice(styles, "\n.lyrics-page {", "/* Followed artists"),
  slice(styles, "\n.lyrics-details {", "\n.lyrics-display.has-pinned-footer"),
  slice(styles, "\n.lyric-scroll {", "\n.follow-lyrics {"),
  slice(styles, "\n.static-lyrics .lyric-line {", "\n.player-bar {"),
];
const snapshot = files.map((file) => [file, read(`frontend/${file}`)]);
mkdirSync("src/lyssna", { recursive: true });
for (const [file, content] of snapshot) write(file, content);
write("types.ts", `${types}\n`);
write("lyrics.css", `@scope (.lyssna-lyrics-view) {${lyrics.join("\n")}\n}\n`);
write("UPSTREAM", `${commit}\n`);
console.log(`Synced Lyssna lyrics from ${commit}`);
