export const opusSampleRate = 48_000;
const channels = 2;
const packetFrames = opusSampleRate / 50;
const packetDuration = 20_000;
const pcmPeak = 0x800000;

export type OpusRecording = {
  bytes: Uint8Array<ArrayBuffer>;
  packetSizes: Uint16Array<ArrayBuffer>;
  description: Uint8Array<ArrayBuffer>;
};

const verifiedBitrates = new Map<number, boolean>();

export function canEncodeOpus() {
  return typeof AudioEncoder === "function" && typeof AudioDecoder === "function";
}

export async function encodeRecordingOpus(pcm: Uint8Array, bitrate: number): Promise<OpusRecording | undefined> {
  if (!canEncodeOpus() || verifiedBitrates.get(bitrate) === false) return;
  const config = { codec: "opus", sampleRate: opusSampleRate, numberOfChannels: channels, bitrate,
    bitrateMode: "constant", opus: { format: "ogg", frameDuration: packetDuration, complexity: 5 } } as const;
  const packets: Uint8Array<ArrayBuffer>[] = [];
  let description: Uint8Array<ArrayBuffer> | undefined;
  let durationMatches = true;
  const encoder = new AudioEncoder({
    output(chunk, metadata) {
      durationMatches &&= chunk.duration === packetDuration;
      const packet = new Uint8Array(chunk.byteLength);
      chunk.copyTo(packet);
      packets.push(packet);
      const header = metadata?.decoderConfig?.description;
      if (header) description = ArrayBuffer.isView(header)
        ? new Uint8Array(header.buffer, header.byteOffset, header.byteLength).slice() : new Uint8Array(header).slice();
    },
    error() { /* flush rejects and the original PCM remains stored. */ },
  });
  try {
    encoder.configure(config);
    // One packet of tail padding lets the decoder discard Opus priming samples.
    const frames = pcm.length / (channels * 3);
    const padded = Math.ceil(frames / packetFrames) * packetFrames + packetFrames;
    const data = new Float32Array(padded * channels);
    for (let i = 0, offset = 0; i < frames * channels; i++, offset += 3) {
      const signed = (pcm[offset] << 8 | pcm[offset + 1] << 16 | pcm[offset + 2] << 24) >> 8;
      data[i] = signed / pcmPeak;
    }
    const audio = new AudioData({ format: "f32", data, timestamp: 0, sampleRate: opusSampleRate,
      numberOfFrames: padded, numberOfChannels: channels });
    try { encoder.encode(audio); }
    finally { audio.close(); }
    await encoder.flush();
    if (!durationMatches || !description || description.byteLength < 19 || packets.length * packetFrames < frames) {
      verifiedBitrates.set(bitrate, false);
      return;
    }
    const bytes = new Uint8Array(packets.reduce((size, packet) => size + packet.byteLength, 0));
    const packetSizes = Uint16Array.from(packets, (packet) => packet.byteLength);
    let offset = 0;
    for (const packet of packets) {
      bytes.set(packet, offset);
      offset += packet.byteLength;
    }
    const encoded = { bytes, packetSizes, description };
    if (!verifiedBitrates.get(bitrate)) {
      await decodeRecordingOpus(encoded, frames);
      verifiedBitrates.set(bitrate, true);
    }
    return encoded;
  } catch {
    verifiedBitrates.set(bitrate, false);
    return;
  } finally { if (encoder.state !== "closed") encoder.close(); }
}

export async function decodeRecordingOpus(recording: OpusRecording, frames: number) {
  const pcm = new Uint8Array(frames * channels * 3);
  let written = 0;
  const decoder = new AudioDecoder({
    output(audio) {
      try {
        const count = Math.min(frames - written, audio.numberOfFrames);
        if (count <= 0) return;
        const plane = new Float32Array(count);
        for (let channel = 0; channel < channels; channel++) {
          audio.copyTo(plane, { planeIndex: channel, frameCount: count, format: "f32-planar" });
          for (let frame = 0; frame < count; frame++) {
            const offset = ((written + frame) * channels + channel) * 3;
            const sample = Math.max(-pcmPeak, Math.min(pcmPeak - 1, Math.round(plane[frame] * pcmPeak)));
            pcm[offset] = sample;
            pcm[offset + 1] = sample >> 8;
            pcm[offset + 2] = sample >> 16;
          }
        }
        written += count;
      } finally { audio.close(); }
    },
    error() { /* flush rejects if the client cannot decode the tile. */ },
  });
  try {
    decoder.configure({ codec: "opus", sampleRate: opusSampleRate, numberOfChannels: channels, description: recording.description });
    let offset = 0;
    for (const [index, size] of recording.packetSizes.entries()) {
      decoder.decode(new EncodedAudioChunk({ type: "key", timestamp: index * packetDuration, duration: packetDuration,
        data: recording.bytes.subarray(offset, offset + size) }));
      offset += size;
    }
    await decoder.flush();
    if (written !== frames) throw new Error("Couldn’t decode the full Opus recording segment.");
    return pcm;
  } finally { if (decoder.state !== "closed") decoder.close(); }
}
