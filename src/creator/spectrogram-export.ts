import { LIVE_COLUMNS, LIVE_ROWS, readLiveTiles } from "./spectrum-storage";
import { colourIndex, storedPaletteTable } from "./spectrum-palette";

export async function exportSpectrogram(uri: string) {
  const tiles = await readLiveTiles(uri, 0, Number.MAX_SAFE_INTEGER);
  if (!tiles.length) throw new Error("No saved spectrogram for this track.");
  const start = tiles[0].index * LIVE_COLUMNS;
  const columns = (tiles.at(-1)!.index + 1) * LIVE_COLUMNS - start;
  const width = Math.min(columns, 8192);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = LIVE_ROWS;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Couldn’t create the spectrogram image.");
  const levels = new Uint16Array(width * LIVE_ROWS);
  for (const tile of tiles) {
    const offset = tile.index * LIVE_COLUMNS - start;
    for (let column = 0; column < LIVE_COLUMNS; column++) {
      if (!tile.filled[column]) continue;
      const x = Math.floor((offset + column) * width / columns);
      for (let row = 0; row < LIVE_ROWS; row++) {
        const pixel = row * width + x;
        levels[pixel] = Math.max(levels[pixel], tile.levels[row * LIVE_COLUMNS + column]);
      }
    }
  }
  const image = context.createImageData(width, LIVE_ROWS);
  const pixels = new Uint32Array(image.data.buffer);
  const palette = new Uint32Array(storedPaletteTable().buffer);
  for (let pixel = 0; pixel < pixels.length; pixel++) {
    pixels[pixel] = palette[colourIndex(levels[pixel], 2)];
  }
  context.putImageData(image, 0, 0);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Couldn’t encode the spectrogram image.")), "image/png");
  });
}
