const replaySeconds = 12;

export type ReplayPacket = {
  uri: string;
  sampleRate: number;
  originMs: number;
  firstFrame: number;
  samples: Int16Array;
};

export function createCapturedReplay() {
  let latest: ReplayPacket | undefined;
  let chunks: ReplayPacket[] = [];
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  const end = (packet: ReplayPacket) => packet.firstFrame + packet.samples.length / 2;

  function canReplay(uri?: string) {
    return !!latest && latest.uri === uri && end(latest) - chunks[0].firstFrame >= latest.sampleRate / 2;
  }

  return {
    canReplay,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    append(packet: ReplayPacket) {
      const ready = canReplay(latest?.uri);
      const contiguous = latest?.uri === packet.uri && latest.sampleRate === packet.sampleRate &&
        latest.originMs === packet.originMs && end(latest) === packet.firstFrame;
      if (!contiguous) chunks = [];
      latest = packet;
      chunks.push(packet);
      const cutoff = end(packet) - replaySeconds * packet.sampleRate;
      while (chunks.length > 1 && end(chunks[0]) <= cutoff) chunks.shift();
      if (!contiguous || ready !== canReplay(packet.uri)) notify();
    },
    clear() {
      if (!latest) return;
      latest = undefined;
      chunks = [];
      notify();
    },
    read(uri: string) {
      if (!latest || !canReplay(uri)) return;
      const { sampleRate, originMs } = latest;
      const lastFrame = end(latest);
      const firstFrame = Math.max(chunks[0].firstFrame, lastFrame - replaySeconds * sampleRate, Math.ceil(-originMs * sampleRate / 1000));
      if (lastFrame <= firstFrame) return;
      const byteLength = (lastFrame - firstFrame) * 4;
      const bytes = new ArrayBuffer(44 + byteLength);
      const header = new DataView(bytes, 0, 44);
      header.setUint32(0, 0x52494646); // RIFF
      header.setUint32(4, 36 + byteLength, true);
      header.setUint32(8, 0x57415645); // WAVE
      header.setUint32(12, 0x666d7420); // fmt
      header.setUint32(16, 16, true);
      header.setUint16(20, 1, true); // PCM
      header.setUint16(22, 2, true);
      header.setUint32(24, sampleRate, true);
      header.setUint32(28, sampleRate * 4, true);
      header.setUint16(32, 4, true);
      header.setUint16(34, 16, true);
      header.setUint32(36, 0x64617461); // data
      header.setUint32(40, byteLength, true);

      const samples = new Int16Array(bytes, 44);
      for (const packet of chunks) {
        const start = Math.max(firstFrame, packet.firstFrame);
        if (start < end(packet)) {
          samples.set(packet.samples.subarray((start - packet.firstFrame) * 2), (start - firstFrame) * 2);
        }
      }
      return {
        blob: new Blob([bytes], { type: "audio/wav" }),
        startMs: originMs + firstFrame * 1000 / sampleRate,
        endMs: originMs + lastFrame * 1000 / sampleRate,
      };
    },
  };
}
