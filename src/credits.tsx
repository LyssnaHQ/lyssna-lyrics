import { useEffect, useState } from "react";
import { CREDIT_NAME_OVERRIDES, lookupDiscordUser, type DiscordIdentity } from "./discord-lookup";
import type { Contributor, Lyrics } from "./lyssna/types";

function CreditPerson({ role, person, usernames }: { role: string; person: Contributor; usernames: boolean }) {
  const [identity, setIdentity] = useState<DiscordIdentity | null>(null);
  const override = CREDIT_NAME_OVERRIDES[person.id];
  const needsLookup = !person.avatar || (usernames && !override);
  useEffect(() => {
    if (!needsLookup) return;
    let active = true;
    void lookupDiscordUser(person.id).then((profile) => { if (active) setIdentity(profile); });
    return () => { active = false; };
  }, [person.id, needsLookup]);

  const account = identity?.username ?? person.discord;
  const creditName = usernames && account && account.toLowerCase() !== person.username.toLowerCase() ? account : person.username;
  const name = `@${(override ?? creditName).replace(/^@+/, "")}`;
  const avatar = person.avatar ?? identity?.avatarUrl;
  const profile = <>
    {avatar && <img key={avatar} src={avatar} alt="" loading="lazy" referrerPolicy="no-referrer"
      onError={(event) => { event.currentTarget.hidden = true; }} />}
    <span className="lyssna-credit-name">{name}</span>
  </>;
  return <span className="lyssna-credit-person"><span>{role}</span>
    {person.url ? <a className="lyssna-credit-profile" href={person.url} target="_blank" rel="noopener noreferrer" title={name}>{profile}</a>
      : <span className="lyssna-credit-profile" title={name}>{profile}</span>}
  </span>;
}

export function LyricCredits({ lyrics, expanded = false, discord = false }: {
  lyrics: Lyrics;
  expanded?: boolean;
  discord?: boolean;
}) {
  const { maker, uploader } = lyrics.attribution ?? {};
  const source = lyrics.source;
  const timing = lyrics.estimated_words ? (lyrics.estimated_lines ? "(+ estimated line and word timing)" : "(+ estimated word timing)")
    : lyrics.split_words ? "(+ extra splits)" : "";
  return (
    <div className={`lyric-source lyssna-provider-credits${expanded ? " expanded" : ""}`}>
      <div>Lyrics provided by: {source === "lrc.red"
        ? <a href="https://lrc.red/" target="_blank" rel="noopener noreferrer">{source}</a> : source}
        {timing && <> <span className="lyssna-credit-timing">{timing}</span></>}
      </div>
      {(maker || uploader) && <div className="lyssna-community-credits">
        {maker && <CreditPerson key={`maker:${maker.id}`} role="Made by" person={maker} usernames={discord} />}
        {uploader && <CreditPerson key={`uploader:${uploader.id}`} role="Uploaded by" person={uploader} usernames={discord} />}
      </div>}
    </div>
  );
}
