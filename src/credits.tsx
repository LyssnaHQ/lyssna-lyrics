import type { Lyrics } from "./lyssna/types";

export function LyricCredits({ lyrics, expanded = false, discord = false }: {
  lyrics: Lyrics;
  expanded?: boolean;
  discord?: boolean;
}) {
  const { maker, uploader } = lyrics.attribution ?? {};
  const source = lyrics.source === "Spicy Lyrics" && (maker || uploader) ? "Spicy Lyrics Community" : lyrics.source;
  const timing = lyrics.estimated_words ? (lyrics.estimated_lines ? " (+ estimated line and word timing)" : " (+ estimated word timing)")
    : lyrics.split_words ? " (+ extra splits)" : "";
  return (
    <div className={`lyric-source lyssna-provider-credits${expanded ? " expanded" : ""}`}>
      <div>Lyrics provided by: {source === "lrc.red"
        ? <a href="https://lrc.red/" target="_blank" rel="noopener noreferrer">{source}</a> : source}{timing}</div>
      {(maker || uploader) && <div className="lyssna-community-credits">
        {([["Made by", maker], ["Uploaded by", uploader]] as const).map(([role, person]) => {
          if (!person) return null;
          const name = `@${(discord && person.discord ? person.discord : person.username).replace(/^@+/, "")}`;
          const profile = <>
            {person.avatar && <img src={person.avatar} alt="" loading="lazy" referrerPolicy="no-referrer"
              onError={(event) => { event.currentTarget.hidden = true; }} />}
            <span>{name}</span>
          </>;
          return <span className="lyssna-credit-person" key={role}><span>{role}</span>
            {person.url ? <a className="lyssna-credit-profile" href={person.url} target="_blank" rel="noopener noreferrer" title={name}>{profile}</a>
              : <span className="lyssna-credit-profile" title={name}>{profile}</span>}
          </span>;
        })}
      </div>}
    </div>
  );
}
