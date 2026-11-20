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

export function TrackMetadata({ host, track, year, yearPosition, reduceMotion, orderByWidth = false }: {
  host: Host; track: Track; year?: string; yearPosition: Settings["lyrics_year_position"]; reduceMotion: boolean; orderByWidth?: boolean;
}) {
  const details = useRef<HTMLDivElement>(null);
  const [artistFirst, setArtistFirst] = useState(false);
  const artists = track.artistLinks?.length ? track.artistLinks : [{ name: track.artists, uri: track.artistUri }];
  const hasYear = year && yearPosition !== "off";
  const dot = hasYear && track.artists && <span className="lyrics-year-dot" aria-hidden="true">·</span>;

  useLayoutEffect(() => {
    const element = details.current;
    if (!orderByWidth || !element) return;
    const title = element.querySelector<HTMLElement>(".lyrics-title .marquee-content");
    const artistParts = element.querySelectorAll<HTMLElement>(".lyrics-artist-names .marquee-content, .lyrics-year, .lyrics-year-dot");
    if (!title || !artistParts.length) return;
    const view = element.ownerDocument.defaultView ?? window;
    const update = () => {
      let artistWidth = 0;
      for (const part of artistParts) {
        artistWidth += part.getBoundingClientRect().width;
        if (part.classList.contains("lyrics-year-dot")) {
          const style = view.getComputedStyle(part);
          artistWidth += parseFloat(style.marginLeft) + parseFloat(style.marginRight);
        }
      }
      setArtistFirst(title.getBoundingClientRect().width > artistWidth);
    };
    const observer = new ResizeObserver(update);
    observer.observe(title);
    for (const part of artistParts) observer.observe(part);
    update();
    return () => observer.disconnect();
  }, [orderByWidth, track.id, track.title, track.artists, hasYear, yearPosition]);

  const title = <Marquee key="title" className="lyrics-title" text={track.title} reduceMotion={reduceMotion}>
    <strong className="song-title"><CatalogueLink host={host} uri={track.albumUri}>{track.title}</CatalogueLink></strong>
  </Marquee>;
  const byline = (hasYear || track.artists) && <div className="lyrics-artists" key="artists">
      {hasYear && yearPosition === "left" && <><span className="lyrics-year">{year}</span>{dot}</>}
      {track.artists && <Marquee className="lyrics-artist-names" text={track.artists} reduceMotion={reduceMotion}>
        {artists.map((artist, index) => <Fragment key={`${artist.uri ?? artist.name}-${index}`}>
          {index > 0 && ", "}<CatalogueLink host={host} uri={artist.uri}>{artist.name}</CatalogueLink>
        </Fragment>)}
      </Marquee>}
      {hasYear && yearPosition === "right" && <>{dot}<span className="lyrics-year">{year}</span></>}
    </div>;
  return <div className="lyrics-details" ref={details}>
    {orderByWidth && artistFirst ? [byline, title] : [title, byline]}
  </div>;
}
