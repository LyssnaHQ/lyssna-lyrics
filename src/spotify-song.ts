const catalogueTrack = /^spotify:track:([A-Za-z0-9]{22})$/;
const localTrack = /^spotify:local:([^:]*):([^:]*):([^:]*):(\d+)$/;

export function spotifySongKey(uri: string | undefined) {
  return catalogueTrack.exec(uri ?? "")?.[1] ?? (uri && localTrack.test(uri) ? uri : undefined);
}

export function spotifySongUri(key: string) {
  return key.startsWith("spotify:local:") ? key : `spotify:track:${key}`;
}

export function localSongTags(uri: string) {
  const match = localTrack.exec(uri);
  if (!match) return;
  const decode = (part: string) => {
    try { return decodeURIComponent(part.replaceAll("+", " ")); }
    catch { return part; }
  };
  return { artist: decode(match[1]), album: decode(match[2]), title: decode(match[3]), duration: Number(match[4]) * 1000 };
}
