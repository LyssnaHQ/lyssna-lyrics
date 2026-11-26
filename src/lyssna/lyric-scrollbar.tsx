import { memo, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "../host-dom";
import type { Lyrics } from "./types";

export const LyricScrollbar = memo(function LyricScrollbar({ scroll, lyrics, browse }: {
  scroll: RefObject<HTMLDivElement | null>;
  lyrics: Lyrics;
  browse(): void;
}) {
  const [edge, setEdge] = useState<HTMLElement | null>(null);
  const thumb = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    const node = scroll.current;
    setEdge(node?.closest<HTMLElement>(".lyrics-page, .lyrics-popout") ?? node?.parentElement ?? null);
  }, [scroll]);

  useLayoutEffect(() => {
    const node = scroll.current;
    const rail = thumb.current;
    if (!node || !rail) return;
    let extent = 0;
    const position = () => {
      if (extent > 0) rail.valueAsNumber = Math.max(0, Math.min(100, node.scrollTop / extent * 100));
    };
    const measure = () => {
      extent = node.scrollHeight - node.clientHeight;
      rail.hidden = extent <= 1;
      if (rail.hidden) return;
      const height = rail.clientHeight;
      const thumbHeight = Math.min(height, Math.max(24, height * node.clientHeight / node.scrollHeight));
      rail.style.setProperty("--lyric-scroll-thumb", `${thumbHeight}px`);
      position();
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      browse();
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? node.clientHeight : 1;
      node.scrollTop += event.deltaY * scale;
    };
    const resize = new ResizeObserver(measure);
    resize.observe(node);
    resize.observe(rail);
    node.addEventListener("scroll", position, { passive: true });
    rail.addEventListener("pointerenter", measure);
    rail.addEventListener("wheel", wheel, { passive: false });
    node.ownerDocument.fonts.addEventListener("loadingdone", measure);
    measure();
    return () => {
      resize.disconnect();
      node.removeEventListener("scroll", position);
      rail.removeEventListener("pointerenter", measure);
      rail.removeEventListener("wheel", wheel);
      node.ownerDocument.fonts.removeEventListener("loadingdone", measure);
    };
  }, [edge, scroll, lyrics, browse]);

  return edge && createPortal(<input ref={thumb} type="range" className="lyric-scrollbar" aria-label="Scroll lyrics"
    min={0} max={100} step="any" defaultValue={0} onPointerDown={browse} onInput={(event) => {
      const node = scroll.current;
      if (!node) return;
      browse();
      node.scrollTop = event.currentTarget.valueAsNumber / 100 * (node.scrollHeight - node.clientHeight);
    }} />, edge);
});
