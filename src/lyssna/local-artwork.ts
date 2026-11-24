export const isLocalArtwork = (url?: string) => /^spotify:(?:localfileimage|local):/.test(url ?? "");

export async function drawLocalArtwork(url: string, page: Document, size: number, square = false) {
  const image = page.createElement("img");
  image.decoding = "async";
  // Spotify serves embedded art through its local scheme, which can be drawn
  // from an image element but cannot be fetched as an ordinary URL.
  image.src = url;
  await image.decode();
  if (!image.naturalWidth || !image.naturalHeight) return;

  const canvas = page.createElement("canvas");
  const scale = Math.min(1, size / Math.max(image.naturalWidth, image.naturalHeight));
  canvas.width = square ? size : Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = square ? size : Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) return;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return { canvas, context };
}
