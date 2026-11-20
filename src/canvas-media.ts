import { fetchSpotifyMedia } from "./spotify-media";
type Profile = { id: number; file_type: string; video_codec: string; video_height: number; video_bitrate: number };
type Manifest = {
  base_urls?: string[];
  initialization_template?: string;
  segment_template?: string;
  contents?: {
    start_time_millis: number;
    end_time_millis: number;
    segment_length: number;
    profiles: Profile[];
  }[];
};

async function getManifest(fileId: string, signal: AbortSignal) {
  const response = await fetchSpotifyMedia((authenticated) =>
    `/manifests/v9/${authenticated ? "json/sources" : "unauth/json/sources"}/${fileId}/options/supports_drm`, signal);
  if (!response.ok) throw new Error(`Canvas manifest HTTP ${response.status}`);
  return await response.json() as Manifest;
}

function mediaReady(target: EventTarget, name: string, signal: AbortSignal, action?: () => void) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const listeners = new AbortController();
    function settle(error?: unknown) {
      listeners.abort();
      if (error) reject(error);
      else resolve();
    }
    const options = { once: true, signal: listeners.signal };
    target.addEventListener(name, () => settle(), options);
    target.addEventListener("error", () => settle(new Error("Canvas playback failed")), options);
    signal.addEventListener("abort", () => settle(signal.reason), options);
    try { action?.(); }
    catch (error) { settle(error); }
  });
}

export async function playCanvasMedia(video: HTMLVideoElement, fileId: string, signal: AbortSignal) {
  if (!/^[a-f0-9]{16,80}$/i.test(fileId) || !globalThis.MediaSource) throw new Error("Canvas media is unavailable");
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
  const manifest = await getManifest(fileId, deadline);
  const content = manifest.contents?.[0];
  const base = manifest.base_urls?.[0];
  const init = manifest.initialization_template;
  const segment = manifest.segment_template;
  if (!content || !base || !init || !segment) throw new Error("Incomplete Canvas manifest");

  const mime = (profile: Profile) => `video/webm; codecs="${profile.video_codec}"`;
  const profile = content.profiles.filter((item) => item.file_type === "webm" && MediaSource.isTypeSupported(mime(item)))
    .sort((a, b) => b.video_height - a.video_height || b.video_bitrate - a.video_bitrate)[0];
  const step = content.segment_length * 1_000;
  const count = Math.ceil((content.end_time_millis - content.start_time_millis) / step);
  if (!profile || !Number.isFinite(count) || count < 1 || count > 60) throw new Error("Canvas format is unavailable");

  function chunk(template: string, milliseconds = 0) {
    const url = new URL(base! + template.replaceAll("{{profile_id}}", String(profile.id))
      .replaceAll("{{file_type}}", profile.file_type).replaceAll("{{segment_timestamp}}", String(Math.round(milliseconds / 1_000))));
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("Invalid Canvas media URL");
    return fetch(url, { signal: deadline, credentials: "omit" }).then((response) => {
      if (!response.ok) throw new Error(`Canvas chunk HTTP ${response.status}`);
      return response.arrayBuffer();
    });
  }

  const media = new MediaSource();
  const url = URL.createObjectURL(media);
  function detach() {
    URL.revokeObjectURL(url);
    if (video.getAttribute("src") === url) {
      video.removeAttribute("src");
      video.load();
    }
  }
  signal.addEventListener("abort", detach, { once: true });
  try {
    await mediaReady(media, "sourceopen", deadline, () => { video.src = url; });
    const buffer = media.addSourceBuffer(mime(profile));
    const segments = await Promise.all([chunk(init), ...Array.from({ length: count }, (_, index) =>
      chunk(segment, content.start_time_millis + index * step))]);
    for (const bytes of segments) await mediaReady(buffer, "updateend", deadline, () => buffer.appendBuffer(bytes));
    media.endOfStream();
  } catch (error) {
    signal.removeEventListener("abort", detach);
    detach();
    throw error;
  }
}
