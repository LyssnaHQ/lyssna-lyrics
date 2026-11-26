import { memo, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "./host-dom";

const REVEAL_DISTANCE = 280;

export const OverlayScrollbar = memo(function OverlayScrollbar({ scroll, label, browse, edgeSelector, contentKey, observeContent = false }: {
  scroll: RefObject<HTMLDivElement | null>;
  label: string;
  browse?(): void;
  edgeSelector?: string;
  contentKey?: unknown;
  observeContent?: boolean;
}) {
  const [edge, setEdge] = useState<HTMLElement | null>(null);
  const thumb = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    if (!edgeSelector) return;
    const node = scroll.current;
    setEdge(node?.closest<HTMLElement>(edgeSelector) ?? node?.parentElement ?? null);
  }, [scroll, edgeSelector]);

  useLayoutEffect(() => {
    const rail = thumb.current;
    const area = rail?.parentElement;
    const view = rail?.ownerDocument.defaultView;
    if (!rail || !area || !view) return;

    let frame = 0;
    let clientX = 0;
    const move = (event: PointerEvent) => {
      if (event.pointerType === "touch" || rail.hidden) return;
      clientX = event.clientX;
      if (frame) return;
      frame = view.requestAnimationFrame(() => {
        frame = 0;
        const distance = area.getBoundingClientRect().right - clientX;
        rail.toggleAttribute("data-near-edge", distance >= 0 && distance <= REVEAL_DISTANCE);
      });
    };
    const leave = () => {
      view.cancelAnimationFrame(frame);
      frame = 0;
      rail.removeAttribute("data-near-edge");
    };
    area.addEventListener("pointerenter", move);
    area.addEventListener("pointermove", move, { passive: true });
    area.addEventListener("pointerleave", leave);
    return () => {
      area.removeEventListener("pointerenter", move);
      area.removeEventListener("pointermove", move);
      area.removeEventListener("pointerleave", leave);
      leave();
    };
  }, [edge]);

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
      rail.style.setProperty("--overlay-scroll-thumb-height", `${thumbHeight}px`);
      position();
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      browse?.();
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? node.clientHeight : 1;
      node.scrollTop += event.deltaY * scale;
    };
    const resize = new ResizeObserver(measure);
    const observe = () => {
      resize.disconnect();
      resize.observe(node);
      resize.observe(rail);
      if (observeContent) for (const child of node.children) resize.observe(child);
    };
    const children = observeContent ? new MutationObserver(() => { observe(); measure(); }) : undefined;
    children?.observe(node, { childList: true });
    observe();
    node.addEventListener("scroll", position, { passive: true });
    rail.addEventListener("pointerenter", measure);
    rail.addEventListener("wheel", wheel, { passive: false });
    node.ownerDocument.fonts.addEventListener("loadingdone", measure);
    measure();
    return () => {
      resize.disconnect();
      children?.disconnect();
      node.removeEventListener("scroll", position);
      rail.removeEventListener("pointerenter", measure);
      rail.removeEventListener("wheel", wheel);
      node.ownerDocument.fonts.removeEventListener("loadingdone", measure);
    };
  }, [edge, scroll, contentKey, observeContent, browse]);

  const rail = <input ref={thumb} type="range" className="overlay-scrollbar" aria-label={label}
    min={0} max={100} step="any" defaultValue={0} onPointerDown={browse} onInput={(event) => {
      const node = scroll.current;
      if (!node) return;
      browse?.();
      node.scrollTop = event.currentTarget.valueAsNumber / 100 * (node.scrollHeight - node.clientHeight);
    }} />;
  return edgeSelector ? edge && createPortal(rail, edge) : rail;
});
