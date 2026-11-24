const LEVEL_SPAN = 4;

export type ColorStop = { position: number; color: string };
export type Palette = "icy" | "green" | "gray" | "inferno" | "viridis" | "magma" | "heat" | "custom";
export const PALETTE_KEY = "lyssna.ttml-spectrum-palette";
export const COLOR_STOPS_KEY = "lyssna.ttml-spectrum-color-stops";
export const PALETTES: { id: Palette; name: string }[] = [
  { id: "icy", name: "Icy Blue" },
  { id: "green", name: "Green" },
  { id: "gray", name: "Grayscale" },
  { id: "inferno", name: "Inferno" },
  { id: "viridis", name: "Viridis" },
  { id: "magma", name: "Magma" },
  { id: "heat", name: "Heat" },
  { id: "custom", name: "Custom" },
];

function ramp(colors: string[]): ColorStop[] {
  return colors.map((color, index) => ({ color, position: index / (colors.length - 1) }));
}

export const DEFAULT_STOPS: ColorStop[] = [
  { position: 0, color: "#000000" },
  { position: 0.1, color: "#260066" },
  { position: 0.5, color: "#ff0000" },
  { position: 0.975, color: "#ffff00" },
  { position: 1, color: "#ffffff" },
];
export const MAX_STOPS = 24;
export function validPalette(value: unknown): value is Palette {
  return PALETTES.some(palette => palette.id === value);
}
export function validColorStops(value: unknown): value is ColorStop[] {
  return Array.isArray(value) && value.length >= 2 && value.length <= MAX_STOPS && value.every(stop =>
    stop && Number.isFinite(stop.position) && stop.position >= 0 && stop.position <= 1 &&
    typeof stop.color === "string" && /^#[0-9a-f]{6}$/i.test(stop.color));
}

const styles = {
  inferno: ramp(["#000004", "#320a5e", "#781c6d", "#bb3654", "#ed6825", "#fbb41a", "#fcffa4"]),
  viridis: ramp(["#440154", "#443983", "#31688e", "#21918c", "#35b779", "#90d743", "#fde725"]),
  magma: ramp(["#000004", "#2d1161", "#721f81", "#b73779", "#f1605d", "#feb078", "#fcfdbf"]),
  heat: DEFAULT_STOPS,
};

function hsl(hue: number, saturation: number, light: number) {
  const chroma = (1 - Math.abs(2 * light - 1)) * saturation;
  const sector = (((hue % 360) + 360) % 360) / 60;
  const second = chroma * (1 - Math.abs((sector % 2) - 1));
  const [r, g, b] = [
    [chroma, second, 0],
    [second, chroma, 0],
    [0, chroma, second],
    [0, second, chroma],
    [second, 0, chroma],
    [chroma, 0, second],
  ][Math.min(5, Math.floor(sector))];
  const base = light - chroma / 2;
  return [r, g, b].map((part) => Math.round((part + base) * 255));
}

// Aegisub's colour schemes, which AMLL's TTML tool also offers.
function legacyColor(palette: Palette, level: number) {
  if (palette === "gray") return [level * 255, level * 255, level * 255];
  if (palette === "green") return hsl(120, 1, Math.min(1, (200 * level) / 255));
  const hue = ((((-128 * level + 191) % 256) + 256) % 256) * (360 / 255);
  return hsl(hue, Math.min(255, 128 * level + 127) / 255, level);
}

export function paletteTable(palette: Palette, custom = DEFAULT_STOPS) {
  const table = new Uint8ClampedArray(256 * 4);
  const stops = palette === "custom" ? custom : palette in styles ? styles[palette as keyof typeof styles] : undefined;
  const sorted = stops?.toSorted((left, right) => left.position - right.position).map(({ position, color }) => {
    const value = parseInt(color.slice(1), 16);
    return { position, channels: [value >> 16, (value >> 8) & 255, value & 255] };
  });
  let right = 0;
  for (let index = 0; index < 256; index++) {
    const level = index / 255;
    if (!sorted) {
      table.set([...legacyColor(palette, level), 255], index * 4);
      continue;
    }
    while (right < sorted.length - 1 && sorted[right].position <= level) right++;
    const high = sorted[right];
    const low = sorted[Math.max(0, right - 1)];
    const spread = high.position - low.position;
    const mix = spread > 0 ? Math.max(0, Math.min(1, (level - low.position) / spread)) : 1;
    const rgb = low.channels.map((channel, channelIndex) => channel + mix * (high.channels[channelIndex] - channel));
    table.set([...rgb, 255], index * 4);
  }
  return table;
}

export function paletteStops(palette: Palette, custom: ColorStop[]): ColorStop[] {
  if (palette === "custom") return custom;
  if (palette in styles) return styles[palette as keyof typeof styles];
  const table = paletteTable(palette);
  return [0, 64, 128, 191, 255].map(index => ({
    position: index / 255,
    color: "#" + Array.from(table.subarray(index * 4, index * 4 + 3), byte => byte.toString(16).padStart(2, "0")).join(""),
  }));
}

export function paletteGradient(stops: ColorStop[]) {
  const ordered = stops.toSorted((left, right) => left.position - right.position);
  return "linear-gradient(90deg in srgb, " + ordered.map(stop => stop.color + " " + stop.position * 100 + "%").join(", ") + ")";
}

export function storedPaletteTable() {
  try {
    const palette: unknown = JSON.parse(localStorage.getItem(PALETTE_KEY) ?? "null");
    const stops: unknown = JSON.parse(localStorage.getItem(COLOR_STOPS_KEY) ?? "null");
    return paletteTable(validPalette(palette) ? palette : "icy", validColorStops(stops) ? stops : DEFAULT_STOPS);
  } catch {
    return paletteTable("icy");
  }
}

export const colourIndex = (encoded: number, gain: number) =>
  Math.min(255, Math.floor((encoded / 65535) * LEVEL_SPAN * gain * 255 + 0.5));
