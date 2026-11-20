import { useLayoutEffect, type RefObject } from "react";

export function useAnchoredPopover(view: Window, open: boolean, trigger: RefObject<HTMLElement | null>,
  panel: RefObject<HTMLElement | null>, matchWidth = false) {
  useLayoutEffect(() => {
    const element = panel.current;
    const button = trigger.current;
    if (!open || !element || !button || !element.showPopover) return;
    element.showPopover();
    const place = () => {
      const gap = 8;
      const box = button.getBoundingClientRect();
      const above = box.top - gap;
      const below = view.innerHeight - box.bottom - gap;
      if (matchWidth) element.style.width = `${box.width}px`;
      const opensAbove = matchWidth ? below < Math.min(element.scrollHeight, 224) && above > below : above >= below;
      const left = Math.max(gap, Math.min(box.left, view.innerWidth - element.offsetWidth - gap));
      element.style.left = `${left}px`;
      element.style.top = opensAbove ? "auto" : `${box.bottom + gap}px`;
      element.style.bottom = opensAbove ? `${view.innerHeight - above}px` : "auto";
      const available = `${Math.max(0, (opensAbove ? above : below) - gap)}px`;
      if (matchWidth) element.style.setProperty("--popover-available-height", available);
      else element.style.maxHeight = available;
      element.style.setProperty("--playbar-popover-anchor", `${box.left + box.width / 2 - left}px`);
      element.dataset.side = opensAbove ? "above" : "below";
    };
    place();
    const observer = new (view as Window & typeof globalThis).ResizeObserver(place);
    if (button.parentElement) observer.observe(button.parentElement);
    observer.observe(element);
    view.addEventListener("resize", place);
    view.addEventListener("scroll", place, true);
    return () => {
      observer.disconnect();
      view.removeEventListener("resize", place);
      view.removeEventListener("scroll", place, true);
      if (element.matches(":popover-open")) element.hidePopover();
    };
  }, [open, panel, trigger, view, matchWidth]);
}
