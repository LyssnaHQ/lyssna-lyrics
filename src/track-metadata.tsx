import { Fragment, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cataloguePath, type Host, type Track } from "./host";
import type { Settings } from "./settings";

function Marquee({ children, text, className, reduceMotion }: {
  children: ReactNode; text: string; className: string; reduceMotion: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(0);
  useLayoutEffect(() => {
    const update = () => setOverflow(Math.max(0, (content.current?.scrollWidth ?? 0) - (box.current?.clientWidth ?? 0)));
    const observer = new ResizeObserver(update);
    if (box.current) observer.observe(box.current);
    if (content.current) observer.observe(content.current);
    update();
    return () => observer.disconnect();
  }, [text]);
  return <div className={`marquee ${className}${overflow > 2 && !reduceMotion ? " scrolling" : ""}`}
    ref={box} title={text} style={{ "--travel": `${overflow}px`, "--duration": `${Math.max(20, (overflow * 2) / 14 + 10)}s` } as CSSProperties}>
    <div className="marquee-content" key={text} ref={content}>{children}</div>
  </div>;
}

function CatalogueLink({ host, uri, children }: { host: Host; uri?: string; children: ReactNode }) {
  const href = cataloguePath(uri);
  return href ? <a href={href} onClick={(event) => {
    if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && host.navigate(href)) event.preventDefault();
  }}>{children}</a> : <>{children}</>;
}

export function TrackMetadata({ host, track, year, yearPosition, reduceMotion }: {
  host: Host; track: Track; year?: string; yearPosition: Settings["lyrics_year_position"]; reduceMotion: boolean;
}) {
  const artists = track.artistLinks?.length ? track.artistLinks : [{ name: track.artists, uri: track.artistUri }];
  const hasYear = year && yearPosition !== "off";
  const dot = hasYear && track.artists && <span className="lyrics-year-dot" aria-hidden="true">·</span>;
  return <div className="lyrics-details">
    <Marquee className="lyrics-title" text={track.title} reduceMotion={reduceMotion}>
      <strong className="song-title"><CatalogueLink host={host} uri={track.albumUri}>{track.title}</CatalogueLink></strong>
    </Marquee>
    <div className="lyrics-artists">
      {hasYear && yearPosition === "left" && <><span className="lyrics-year">{year}</span>{dot}</>}
      {track.artists && <Marquee className="lyrics-artist-names" text={track.artists} reduceMotion={reduceMotion}>
        {artists.map((artist, index) => <Fragment key={`${artist.uri ?? artist.name}-${index}`}>
          {index > 0 && ", "}<CatalogueLink host={host} uri={artist.uri}>{artist.name}</CatalogueLink>
        </Fragment>)}
      </Marquee>}
      {hasYear && yearPosition === "right" && <>{dot}<span className="lyrics-year">{year}</span></>}
    </div>
  </div>;
}
