import { useLayoutEffect, type RefObject } from "react";

export function usePlaybarPopover(view: Window & typeof globalThis, open: boolean, trigger: RefObject<HTMLElement | null>,
  panel: RefObject<HTMLElement | null>) {
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
      const opensAbove = above >= below;
      const left = Math.max(gap, Math.min(box.left, view.innerWidth - element.offsetWidth - gap));
      element.style.left = `${left}px`;
      element.style.top = opensAbove ? "auto" : `${box.bottom + gap}px`;
      element.style.bottom = opensAbove ? `${view.innerHeight - above}px` : "auto";
      element.style.maxHeight = `${Math.max(0, (opensAbove ? above : below) - gap)}px`;
      element.style.setProperty("--playbar-popover-anchor", `${box.left + box.width / 2 - left}px`);
      element.dataset.side = opensAbove ? "above" : "below";
    };
    place();
    const observer = new view.ResizeObserver(place);
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
  }, [open, panel, trigger, view]);
}
