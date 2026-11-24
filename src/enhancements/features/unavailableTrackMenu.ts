import { getSetting } from "../config";
import { isElementVisible, rootMenuSelector } from "../dom";

type CopyAction = { label: string; copy(uri: string): void };
type Fiber = { memoizedProps?: Record<string, unknown>; return?: Fiber };
export const rowSelector = ".main-trackList-trackListRow, [data-testid='tracklist-row']";
const unavailableSelector = "[aria-disabled='true'], [data-disabled], .main-trackList-trackListRow--disabled, .uWhqNrxEmH2qfzeRF1d2";
const trackUri = /^spotify:track:[A-Za-z0-9]{22}$/;

export function* rowProps(element: Element, limit: number) {
  const fields = element as unknown as Record<string, unknown>;
  const fiberKey = Object.keys(fields).find(key => key.startsWith("__reactFiber$"));
  for (let fiber = fiberKey ? fields[fiberKey] as Fiber : undefined; fiber && limit > 0; fiber = fiber.return, limit--) {
    if (fiber.memoizedProps) yield fiber.memoizedProps;
  }
}

export function spotifyTrackRow(row: HTMLElement) {
  let unavailable = row.matches(unavailableSelector) || !!row.closest("[role='row'][aria-disabled='true']");
  let uri = row.dataset.uri;
  let context: string | undefined;
  let index: number | undefined;
  let restricted = false;
  // Unavailable tracks may render a plain title. Read the row component's
  // own track URI before relying on a link in the row.
  for (const props of rowProps(row, 8)) {
    const candidate = props.uri ?? (props.item as { uri?: string } | undefined)?.uri;
    if (typeof candidate !== "string" || !trackUri.test(candidate)) continue;
    if (uri && trackUri.test(uri) && uri !== candidate) break;
    uri = candidate;
    unavailable ||= props.isPlayable === false;
    if (typeof props.contextUri === "string") context ??= props.contextUri;
    if (typeof props.index === "number") index ??= props.index;
    restricted ||= !!(props.isArtistBanned || props.isBannedInContext || props.ageRestricted);
  }
  const link = row.querySelector<HTMLAnchorElement>("a[href^='/track/']");
  uri ??= link?.pathname.match(/^\/track\/([A-Za-z0-9]{22})$/)?.[0].replace("/track/", "spotify:track:");
  if (uri && trackUri.test(uri)) return { row, uri, context, index, unavailable, restricted };
}

function unavailableTrack(target: Element) {
  const row = target.closest<HTMLElement>(rowSelector);
  const track = row && spotifyTrackRow(row);
  if (track && track.unavailable) return track;
}

const visibleMenus = () => Array.from(document.querySelectorAll<HTMLElement>(rootMenuSelector)).filter(isElementVisible);

export function startUnavailableTrackMenu(actions: CopyAction[]) {
  let close: (() => void) | undefined;
  let pending: number | undefined;
  let previousMenus: Map<HTMLElement, Element | null> | undefined;
  const nativeOpened = () => !!previousMenus && visibleMenus().some(menu =>
    menu.childElementCount > 0 && previousMenus?.get(menu) !== menu.firstElementChild,
  );

  function dismiss() {
    window.clearTimeout(pending);
    previousMenus = undefined;
    close?.();
  }

  document.addEventListener("contextmenu", event => {
    dismiss();
    if (!getSetting("showTrackCopyMenu") || !(event.target instanceof Element)) return;
    if (event.target.closest("input, textarea, [contenteditable='true']")) return;
    const target = unavailableTrack(event.target);
    if (!target) return;

    previousMenus = new Map(visibleMenus().map(menu => [menu, menu.firstElementChild]));
    // Give Spotify's menu first chance to open. This prevents the browser's
    // default menu from covering the track actions when Spotify has no rows.
    event.preventDefault();
    const { clientX, clientY } = event;
    pending = window.setTimeout(() => {
      if (nativeOpened() || !target.row.isConnected || !getSetting("showTrackCopyMenu")) return;

      const menu = document.createElement("div");
      menu.className = "lyssna-unavailable-track-menu";
      menu.setAttribute("role", "menu");
      menu.setAttribute("aria-label", "Copy");

      const session = new AbortController();
      const options = { capture: true, signal: session.signal };
      close = () => {
        session.abort();
        menu.remove();
        close = undefined;
      };
      const buttons = actions.map(({ label, copy }) => {
        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute("role", "menuitem");
        button.textContent = label;
        button.addEventListener("click", () => {
          dismiss();
          copy(target.uri);
        });
        menu.append(button);
        return button;
      });
      document.body.append(menu);
      const rowBounds = target.row.getBoundingClientRect();
      const x = clientX || rowBounds.left;
      const y = clientY || rowBounds.bottom;
      menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - menu.offsetWidth - 4))}px`;
      menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - menu.offsetHeight - 4))}px`;
      buttons[0]?.focus({ preventScroll: true });

      document.addEventListener("pointerdown", event => {
        if (!event.composedPath().includes(menu)) dismiss();
      }, options);
      window.addEventListener("scroll", dismiss, options);
      window.addEventListener("resize", dismiss, options);
      window.addEventListener("blur", dismiss, options);
      menu.addEventListener("keydown", event => {
        if (event.key === "Tab") { dismiss(); return; }
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          dismiss();
          target.row.closest<HTMLElement>("[tabindex]")?.focus({ preventScroll: true });
          return;
        }
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        event.stopPropagation();
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const step = event.key === "ArrowDown" ? 1 : -1;
        buttons[(index + step + buttons.length) % buttons.length]?.focus();
      });
    }, 120);
  }, true);

  return () => {
    if (!getSetting("showTrackCopyMenu") || nativeOpened()) dismiss();
  };
}
