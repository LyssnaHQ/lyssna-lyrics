# Third-party notices

## Fraktality/spr

The analytic spring in `src/lyssna/lyric-motion.ts` is a port of [Fraktality/spr](https://github.com/Fraktality/spr).

MIT License

Copyright (c) 2023 Fractality

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

The Lucide icons are distributed under the ISC license. Some are derived from Feather under MIT. The [Lucide license](https://github.com/lucide-icons/lucide/blob/main/LICENSE) accompanies the built plugin.

Lyssna's gibberish dictionary and filter, and the full screen transport glyphs, come from [the pixels-spicy-lyrics fork](https://github.com/iPixelGalaxy/spicy-lyrics) under AGPL-3.0. The app snapshot records the source revision in `src/lyssna/UPSTREAM`.

The desktop Lyssna fonts are [Inter](https://github.com/rsms/inter) by the Inter Project Authors under the SIL Open Font License and [Metropolis](https://github.com/chrismsimpson/Metropolis) by Chris Simpson under the Unlicense. Their license texts accompany the built plugin.

## Lyric romanization

The WebAssembly romanizer uses [Lyssna's lyric-romanize crate](https://github.com/LyssLabs/lyssna-app/tree/25c40c8ff1f9bf32123e6bf5d4b190b3135e5abe/crates/lyric-romanize) under AGPL-3.0. The plugin includes its source and a browser adapter in `crates/lyric-romanize`. Run `npm run build:romanization` with Rust's `wasm32-unknown-unknown` target to regenerate the downloadable engine.

The [Lindera IPADIC dictionary](https://github.com/lindera/mecab-ipadic) is embedded in the engine. Its copyright and license are included in `crates/lyric-romanize/licenses` alongside the Rust libraries' notices.
