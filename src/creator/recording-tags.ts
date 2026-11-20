import type { RecordingMetadata } from "./recording-metadata";

const text = new TextEncoder();

function riffChunk(id: string, body: Blob) {
  const header = new Uint8Array(8);
  header.set(text.encode(id));
  new DataView(header.buffer).setUint32(4, body.size, true);
  return new Blob([header, body, new Uint8Array(body.size % 2)]);
}

function syncsafe(size: number) {
  return Uint8Array.of((size >>> 21) & 127, (size >>> 14) & 127, (size >>> 7) & 127, size & 127);
}

function id3Frame(id: string, body: Blob) {
  return new Blob([text.encode(id), syncsafe(body.size), new Uint8Array(2), body]);
}

export function id3Tag({ tags, cover }: RecordingMetadata) {
  const frames = tags.map(({ id3, name, value }) => {
    if (id3?.startsWith("W")) return id3Frame(id3, new Blob([value]));
    const encoded = id3 ? value : `${name}\0${value}`;
    return id3Frame(id3 ?? "TXXX", new Blob([Uint8Array.of(3), encoded]));
  });
  if (cover) {
    frames.push(id3Frame("APIC", new Blob([
      Uint8Array.of(3), `${cover.type}\0`, Uint8Array.of(3, 0), cover.blob,
    ])));
  }
  const body = new Blob(frames);
  return new Blob(["ID3", Uint8Array.of(4, 0, 0), syncsafe(body.size), body]);
}

export function tagWav(wav: Blob, metadata: RecordingMetadata) {
  const info = metadata.tags.flatMap(({ riff, value }) => riff ? [riffChunk(riff, new Blob([`${value}\0`]))] : []);
  const chunks = [riffChunk("LIST", new Blob(["INFO", ...info])), riffChunk("id3 ", id3Tag(metadata))];
  const size = wav.size - 8 + chunks.reduce((total, chunk) => total + chunk.size, 0);
  if (size > 0xffffffff) throw new Error("The recording is too large to export as a tagged WAV.");
  const riffSize = new DataView(new ArrayBuffer(4));
  riffSize.setUint32(0, size, true);
  // Captured WAV files have a 44-byte PCM header. Insert tags before the data chunk.
  return new Blob([wav.slice(0, 4), riffSize.buffer, wav.slice(8, 36), ...chunks, wav.slice(36)], { type: "audio/wav" });
}
