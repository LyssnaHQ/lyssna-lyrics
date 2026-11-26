import { memo, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "./host-dom";

const REVEAL_DISTANCE = 280;
const MIN_THUMB_HEIGHT = 24;

export const OverlayScrollbar = memo(function OverlayScrollbar({ scroll, label, browse, edgeSelector, contentKey, alignTo, observeContent = false }: {
  scroll: RefObject<HTMLDivElement | null>;
  label: string;
  browse?(): void;
  edgeSelector?: string;
  contentKey?: unknown;
  alignTo?: string;
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
    let clientY = 0;
    const move = (event: PointerEvent) => {
      if (event.pointerType === "touch" || rail.hidden || rail.hasAttribute("data-dragging")) return;
      clientX = event.clientX;
      clientY = event.clientY;
      if (frame) return;
      frame = view.requestAnimationFrame(() => {
        frame = 0;
        const { right, top, bottom } = rail.getBoundingClientRect();
        const distance = right - clientX;
        rail.toggleAttribute("data-near-edge", distance >= 0 && distance <= REVEAL_DISTANCE && clientY >= top && clientY <= bottom);
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
    const area = rail?.parentElement;
    if (!node || !rail || !area) return;
    let extent = 0;
    let thumbHeight = 0;
    let drag: { pointerId: number; top: number; travel: number; grabOffset: number } | undefined;
    const position = () => {
      if (extent > 0 && !drag) rail.valueAsNumber = Math.max(0, Math.min(100, node.scrollTop / extent * 100));
    };
    const measure = () => {
      extent = node.scrollHeight - node.clientHeight;
      if (extent <= 1) {
        rail.hidden = true;
        return;
      }

      // The rail can sit at the page edge while the scroller ends above a pinned footer.
      const anchor = area.getBoundingClientRect();
      const viewport = node.getBoundingClientRect();
      const scale = anchor.height / area.offsetHeight || 1;
      const top = (viewport.top - anchor.top) / scale + node.clientTop - area.clientTop;
      const viewportStart = Math.max(0, top);
      const viewportEnd = Math.min(area.clientHeight, top + node.clientHeight);
      // Match the top and bottom insets when the rail is at the lyrics page edge.
      const inset = Math.max(viewportStart, area.clientHeight - viewportEnd);
      const symmetric = edge && inset * 2 < area.clientHeight;
      let start = symmetric ? inset : viewportStart;
      let end = symmetric ? area.clientHeight - inset : viewportEnd;
      if (alignTo) {
        const first = Array.from(node.querySelectorAll<HTMLElement>(alignTo)).find(box => box.offsetHeight > 0);
        if (first) {
          // Rebase to the top of the content so scrolling never moves the track itself.
          const gap = Math.max(0, (first.getBoundingClientRect().top - viewport.top) / scale + node.scrollTop - node.clientTop);
          if (gap * 2 + MIN_THUMB_HEIGHT < end - start) {
            start += gap;
            end -= gap;
          }
        }
      }
      rail.style.setProperty("--overlay-scroll-top", `${start}px`);
      rail.style.setProperty("--overlay-scroll-height", `${Math.max(0, end - start)}px`);
      rail.hidden = false;
      const height = rail.clientHeight;
      if (height <= 0) {
        rail.hidden = true;
        return;
      }
      thumbHeight = Math.min(height, Math.max(MIN_THUMB_HEIGHT, height * node.clientHeight / node.scrollHeight));
      rail.style.setProperty("--overlay-scroll-thumb-height", `${thumbHeight}px`);
      position();
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      browse?.();
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? node.clientHeight : 1;
      node.scrollTop += event.deltaY * scale;
    };
    const dragTo = (event: PointerEvent) => {
      if (drag?.pointerId !== event.pointerId) return;
      const ratio = Math.max(0, Math.min(1, (event.clientY - drag.top - drag.grabOffset) / drag.travel));
      browse?.();
      rail.valueAsNumber = ratio * 100;
      node.scrollTo({ top: ratio * extent, behavior: "instant" });
    };
    const startDrag = (event: PointerEvent) => {
      if (event.button !== 0 || !event.isPrimary || drag || rail.hidden || extent <= 0) return;
      const bounds = rail.getBoundingClientRect();
      const visibleThumb = thumbHeight * bounds.height / rail.clientHeight;
      const travel = bounds.height - visibleThumb;
      if (!(travel > 0)) return;
      const thumbTop = node.scrollTop / extent * travel;
      const withinThumb = event.clientY - bounds.top - thumbTop;
      const grabOffset = withinThumb >= 0 && withinThumb <= visibleThumb ? withinThumb : visibleThumb / 2;
      event.preventDefault();
      rail.focus({ preventScroll: true });
      rail.setPointerCapture(event.pointerId);
      drag = { pointerId: event.pointerId, top: bounds.top, travel, grabOffset };
      rail.setAttribute("data-dragging", "");
      dragTo(event);
    };
    const endDrag = (event?: PointerEvent) => {
      if (!drag || (event && event.pointerId !== drag.pointerId)) return;
      const { pointerId } = drag;
      drag = undefined;
      if (rail.hasPointerCapture(pointerId)) rail.releasePointerCapture(pointerId);
      rail.removeAttribute("data-dragging");
      position();
    };
    const resize = new ResizeObserver(measure);
    const observe = () => {
      resize.disconnect();
      resize.observe(node);
      resize.observe(area);
      if (observeContent) for (const child of node.children) resize.observe(child);
    };
    const children = observeContent ? new MutationObserver(() => { observe(); measure(); }) : undefined;
    children?.observe(node, { childList: true });
    observe();
    node.addEventListener("scroll", position, { passive: true });
    rail.addEventListener("pointerenter", measure);
    rail.addEventListener("wheel", wheel, { passive: false });
    rail.addEventListener("pointerdown", startDrag);
    rail.addEventListener("pointermove", dragTo);
    rail.addEventListener("pointerup", endDrag);
    rail.addEventListener("pointercancel", endDrag);
    rail.addEventListener("lostpointercapture", endDrag);
    node.ownerDocument.fonts.addEventListener("loadingdone", measure);
    measure();
    return () => {
      resize.disconnect();
      children?.disconnect();
      node.removeEventListener("scroll", position);
      rail.removeEventListener("pointerenter", measure);
      rail.removeEventListener("wheel", wheel);
      rail.removeEventListener("pointerdown", startDrag);
      rail.removeEventListener("pointermove", dragTo);
      rail.removeEventListener("pointerup", endDrag);
      rail.removeEventListener("pointercancel", endDrag);
      rail.removeEventListener("lostpointercapture", endDrag);
      endDrag();
      node.ownerDocument.fonts.removeEventListener("loadingdone", measure);
    };
  }, [edge, scroll, contentKey, alignTo, observeContent, browse]);

  const rail = <input ref={thumb} type="range" className="overlay-scrollbar" aria-label={label}
    min={0} max={100} step="any" defaultValue={0} onInput={(event) => {
      const node = scroll.current;
      if (!node) return;
      browse?.();
      node.scrollTop = event.currentTarget.valueAsNumber / 100 * (node.scrollHeight - node.clientHeight);
    }} />;
  return edgeSelector ? edge && createPortal(rail, edge) : rail;
});
