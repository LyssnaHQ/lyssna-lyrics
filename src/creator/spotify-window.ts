const colors = [[255, 44, 80], [12, 239, 102], [40, 109, 255], [255, 224, 20]];
const markerLength = 24;

export function spotifyWindowMarker(view: Window & typeof globalThis) {
  const { document } = view;
  const marker = document.createElement("div");
  marker.setAttribute("aria-hidden", "true");
  Object.assign(marker.style, {
    position: "fixed", left: "16px", top: "80px", zIndex: "2147483647", pointerEvents: "none",
    display: "flex", width: "min(360px, 80vw)", height: "18px",
  });

  // A fresh pattern identifies this exact Spotify window, even when other windows have the same title.
  let color = 0;
  const pattern = Array.from(view.crypto.getRandomValues(new Uint8Array(markerLength)), (byte) => {
    color = (color + 1 + byte % (colors.length - 1)) % colors.length;
    const stripe = document.createElement("span");
    stripe.style.cssText = `display:block;flex:1 1 0;background:rgb(${colors[color].join(",")})`;
    marker.append(stripe);
    return color;
  });
  (document.fullscreenElement ?? document.body).append(marker);

  return {
    remove: () => marker.remove(),
    async matches(track: MediaStreamTrack, signal: AbortSignal) {
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.srcObject = new view.MediaStream([track]);
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", { willReadFrequently: true });
      try {
        if (!context) return false;
        void video.play().catch(() => {});
        const deadline = view.performance.now() + 2500;
        while (!signal.aborted && track.readyState === "live" && view.performance.now() < deadline) {
          if (video.readyState >= 2 && video.videoWidth > 0) {
            const scale = Math.min(1, 960 / video.videoWidth);
            canvas.width = Math.round(video.videoWidth * scale);
            // Spotify's marker sits near the top of the captured window, below the native title bar.
            canvas.height = Math.round(Math.min(video.videoHeight * scale, 230));
            context.drawImage(video, 0, 0, canvas.width, Math.round(video.videoHeight * scale));
            const frame = context.getImageData(0, 0, canvas.width, canvas.height);
            if (containsMarker(frame, pattern)) return true;
          }
          await new Promise<void>((resolve) => view.setTimeout(resolve, 160));
        }
        return false;
      } finally {
        video.pause();
        video.srcObject = null;
      }
    },
  };
}

function containsMarker({ data, width, height }: ImageData, pattern: number[]) {
  for (let y = 0; y < height; y += 2) {
    let found = 0;
    let last = -1;
    let gap = 0;
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const color = colors.findIndex(([r, g, b]) => Math.abs(data[offset] - r) < 55 &&
        Math.abs(data[offset + 1] - g) < 55 && Math.abs(data[offset + 2] - b) < 55);
      if (color < 0) {
        // A scaled frame can blend a pixel on the edge between two stripes.
        if (++gap > 2) { found = 0; last = -1; }
        continue;
      }
      gap = 0;
      if (color === last) continue;
      last = color;
      found = color === pattern[found] ? found + 1 : Number(color === pattern[0]);
      if (found === pattern.length) return true;
    }
  }
  return false;
}
