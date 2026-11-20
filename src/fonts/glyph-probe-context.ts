import { GLYPH_PROBE_FONT } from "./glyph-probe";

export const glyphProbeFamily = "LyssnaLyricsGlyphProbe";
const probes = new WeakMap<Document, Promise<CanvasRenderingContext2D | null>>();

export function getGlyphProbe(page: Document): Promise<CanvasRenderingContext2D | null> {
  const existing = probes.get(page);
  if (existing) return existing;
  const probe = (async () => {
    if (typeof FontFace === "undefined" || !page.fonts) return null;
    try {
      const font = new FontFace(glyphProbeFamily, `url("${GLYPH_PROBE_FONT}")`);
      await font.load();
      page.fonts.add(font);
      const context = page.createElement("canvas").getContext("2d");
      if (!context) return null;
      context.font = `700 48px ${glyphProbeFamily}`;
      if (context.measureText("A中ا𐐀").width !== 0) {
        page.fonts.delete(font);
        return null;
      }
      return context;
    } catch {
      return null;
    }
  })();
  probes.set(page, probe);
  return probe;
}
