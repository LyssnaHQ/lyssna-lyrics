import { useContext, useEffect, useState, type CSSProperties, type MouseEvent } from "react";
import { UserRound } from "lucide-react";
import appleMusicAvatar from "./apple-music-avatar.webp?inline";
import { CREDIT_NAME_OVERRIDES, lookupDiscordUser, type DiscordIdentity } from "./discord-lookup";
import { readLyssnaAppleCredit } from "./lyssna-provider";
import type { Contributor, Lyrics } from "./lyssna/types";
import { lyssnaSongUrl, SongSheetContext } from "./song-sheet";

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
  const credit = lyrics.credit?.replace(/^Lyrics provided by\b:?\s*/i, "") || source;
  const via = /\s+(\(via [^()]+\))$/i.exec(credit);
  const provider = via ? credit.slice(0, via.index) : credit;
  const timing = lyrics.estimated_words ? (lyrics.estimated_lines ? "(+ estimated line and word timing)" : "(+ estimated word timing)")
    : lyrics.split_words ? "(+ extra splits)" : "";
  return (
    <div className={`lyric-source lyssna-provider-credits${expanded ? " expanded" : ""}`}>
      <div>Lyrics provided by: {source === "lrc.red"
        ? <a href="https://lrc.red/" target="_blank" rel="noopener noreferrer">{provider}</a> : provider}
        {via && <> <span className="lyssna-credit-suffix">{via[1]}</span></>}
        {timing && <> <span className="lyssna-credit-suffix">{timing}</span></>}
      </div>
      {lyrics.lyssna ? <LyssnaContributors attribution={lyrics.lyssna} /> : (maker || uploader) && <div className="lyssna-community-credits">
        {maker && <CreditPerson key={`maker:${maker.id}`} role="Made by" person={maker} usernames={discord} />}
        {uploader && <CreditPerson key={`uploader:${uploader.id}`} role="Uploaded by" person={uploader} usernames={discord} />}
      </div>}
    </div>
  );
}

function LyssnaContributors({ attribution }: { attribution: NonNullable<Lyrics["lyssna"]> }) {
  const songUrl = lyssnaSongUrl(attribution.songId);
  const open = useContext(SongSheetContext);
  const revisionId = attribution.contributors.some(({ original }) => original) ? undefined : attribution.revisionId;
  const [appleCredit, setAppleCredit] = useState<{ revisionId: string; credited: boolean }>();
  useEffect(() => {
    if (!revisionId) return;
    let active = true;
    void readLyssnaAppleCredit(attribution.songId, revisionId).then(credited => {
      if (active) setAppleCredit({ revisionId, credited: credited ?? false });
    });
    return () => { active = false; };
  }, [attribution.songId, revisionId]);

  const openSong = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!songUrl || !open || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    open(songUrl);
  };
  const apple = revisionId !== undefined && appleCredit?.revisionId === revisionId && appleCredit.credited;
  const ranked = attribution.contributors.toSorted((left, right) => right.share - left.share);
  const contributors = ranked.slice(0, apple ? 4 : 5);
  const named = contributors.filter(({ share, text_share, timing_share }, index) => {
    const timing = timing_share ?? 0;
    if (apple) return timing >= 30;
    return index === 0 || Math.max(share, text_share ?? 0, timing) >= 30;
  }).slice(0, 2);
  return (apple || contributors.length > 0) && <div className="lyssna-community-credits lyssna-contributors">
    <span>Contributors:</span>
    <span className="lyssna-contributor-avatars">
      {apple && songUrl && <a className="lyssna-contributor-avatar" style={{ "--avatar-layer": contributors.length + 1 } as CSSProperties}
        onClick={openSong} href={songUrl} target="_blank" rel="noopener noreferrer" title="Apple Music" aria-label="Apple Music lyric credits">
        <img src={appleMusicAvatar} alt="" />
      </a>}
      {contributors.map(({ user_id, username, avatar_url }, index) => {
        const name = username || "Deleted user";
        const position = { "--avatar-layer": contributors.length - index } as CSSProperties;
        const avatar = <>
          <UserRound aria-hidden="true" />
          {username && avatar_url && <img key={avatar_url} src={avatar_url} alt="" loading="lazy" referrerPolicy="no-referrer"
            onError={(event) => { event.currentTarget.hidden = true; }} />}
        </>;
        return username
          ? <a key={user_id ?? index} className="lyssna-contributor-avatar" style={position} onClick={openSong} href={songUrl ?? lyssnaProfile(username)}
            target="_blank" rel="noopener noreferrer" title={name} aria-label={name}>{avatar}</a>
          : <span key={user_id ?? index} className="lyssna-contributor-avatar" style={position} role="img"
            title={name} aria-label={name}>{avatar}</span>;
      })}
    </span>
    <span className="lyssna-contributor-names">
      {apple && songUrl && <span>
        <a className="lyssna-credit-profile" onClick={openSong} href={songUrl} target="_blank" rel="noopener noreferrer">
          <span className="lyssna-credit-name">Apple Music</span>
        </a>{named.length > 0 && ","}
      </span>}
      {named.map(({ user_id, username }, index) => <span key={user_id ?? index}>
        {username ? <a className="lyssna-credit-profile" onClick={openSong} href={songUrl ?? lyssnaProfile(username)} target="_blank" rel="noopener noreferrer">
          <span className="lyssna-credit-name">{username}</span>
        </a> : "Deleted user"}{index < named.length - 1 && ","}
      </span>)}
    </span>
  </div>;
}

function lyssnaProfile(username: string) {
  return `https://lyssna.org/u/${encodeURIComponent(username)}`;
}
