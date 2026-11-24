import { readLiveTiles } from "./spectrum-storage";
import { colourIndex, storedPaletteTable } from "./spectrum-palette";

export async function exportSpectrogram(uri: string) {
  const tiles = await readLiveTiles(uri, 0, Number.MAX_SAFE_INTEGER);
  if (!tiles.length) throw new Error("No saved spectrogram for this track.");
  const columnsPerTile = tiles.reduce((max, tile) => Math.max(max, tile.filled.length), 0);
  const rows = tiles.reduce((max, tile) => Math.max(max, tile.levels.length / tile.filled.length), 0);
  const start = tiles[0].index * columnsPerTile;
  const columns = (tiles.at(-1)!.index + 1) * columnsPerTile - start;
  const width = Math.min(columns, 16_384);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = rows;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Couldn’t create the spectrogram image.");
  const levels = new Uint16Array(width * rows);
  for (const tile of tiles) {
    const tileColumns = tile.filled.length;
    const tileRows = tile.levels.length / tileColumns;
    const offset = tile.index * columnsPerTile - start;
    for (let column = 0; column < columnsPerTile; column++) {
      const source = Math.floor(column * tileColumns / columnsPerTile);
      if (!tile.filled[source]) continue;
      const x = Math.floor((offset + column) * width / columns);
      for (let row = 0; row < rows; row++) {
        const pixel = row * width + x;
        const sourceRow = Math.floor(row * tileRows / rows);
        levels[pixel] = Math.max(levels[pixel], tile.levels[sourceRow * tileColumns + source]);
      }
    }
  }
  const image = context.createImageData(width, rows);
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
