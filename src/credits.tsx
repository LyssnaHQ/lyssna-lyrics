import type { Lyrics } from "./lyssna/types";

export function LyricCredits({ lyrics, expanded = false, discord = false }: {
  lyrics: Lyrics;
  expanded?: boolean;
  discord?: boolean;
}) {
  return (
    <div className={`lyric-source${expanded ? " expanded" : ""}`}>
      <span>Lyrics from {lyrics.source}</span>
      {expanded && [lyrics.attribution?.maker, lyrics.attribution?.uploader].map((person, index) => {
        if (!person) return null;
        const name = discord && person.discord ? `@${person.discord}` : person.username;
        return <span key={index}> · {person.url?.startsWith("https://")
          ? <a className="text-link" href={person.url} target="_blank" rel="noreferrer">{name}</a>
          : name}</span>;
      })}
    </div>
  );
}
