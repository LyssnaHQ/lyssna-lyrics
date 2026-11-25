import type { Host } from "../../host";
import { kit, Spicetify } from "../compat";
import { getSetting, SETTINGS_CHANGED_EVENT } from "../config";
import {
  encoreMenu, encoreMenuRow, getEncoreSubmenu, getEncoreSubmenuTrigger, getMenuRowAction, isElementVisible,
  menuActionLabel, normalizeText, openEncoreSubmenu, rootMenuSelector, toggleElementDisplay, useVisibleEncoreMenuOrder,
} from "../dom";
import { observeMenus } from "../observeMenus";
import { createContextMenuItem, createContextMenuSubMenu, resetMenuContext } from "./contextMenu";
import { startUnavailableTrackMenu } from "./unavailableTrackMenu";

const cleanLabel = "Copy Clean URL";
const embedLabel = "Embed";
const customEmbedLabel = `${embedLabel}\u2063`;
const copyLabel = "Copy/Share\u2063";
const nativeShareAttribute = "data-lyssna-native-share";
const dividerAttribute = "data-lyssna-share-divider";
const openingEmbed = new WeakSet<HTMLElement>();
const shareTypes = new Set(["track", "album", "artist", "playlist", "show", "episode", "audiobook", "user", "concert", "venue"]);
const noEmbed = new Set(["user", "concert", "venue"]);

const cleanIcon = '<path fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" d="M7 4.5l2-2a3.2 3.2 0 0 1 4.5 4.5l-2 2M9 11.5l-2 2A3.2 3.2 0 0 1 2.5 9l2-2M5.75 10.25l4.5-4.5"></path>';
const embedIcon = '<path fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" d="M5 4.75 1.75 8 5 11.25m6-6.5L14.25 8 11 11.25M9.25 2.75l-2.5 10.5"></path>';

const artistIcon = '<path d="M11.757 2.987A4.36 4.36 0 0 0 7.618 0a4.36 4.36 0 0 0-4.139 2.987 5.5 5.5 0 0 0-.22 1.894 5.6 5.6 0 0 0 1.4 3.312l.125.152a.748.748 0 0 1-.2 1.128l-2.209 1.275A4.75 4.75 0 0 0 0 14.857v1.142h8.734A5.5 5.5 0 0 1 8.15 14.5H1.517a3.25 3.25 0 0 1 1.6-2.454l2.21-1.275a2.25 2.25 0 0 0 .6-3.386l-.128-.153a4.1 4.1 0 0 1-1.05-2.44A4 4 0 0 1 4.89 3.47a2.8 2.8 0 0 1 1.555-1.713 2.89 2.89 0 0 1 3.293.691c.265.296.466.644.589 1.022.12.43.169.876.144 1.322a4.12 4.12 0 0 1-1.052 2.44l-.127.153a2.24 2.24 0 0 0-.2 2.58c.338-.45.742-.845 1.2-1.173 0-.162.055-.32.156-.447l.126-.152a5.6 5.6 0 0 0 1.4-3.312 5.5 5.5 0 0 0-.218-1.894zm3.493 3.771a.75.75 0 0 0-.75.75v3.496h-1a2.5 2.5 0 0 0-2.31 1.542 2.497 2.497 0 0 0 1.822 3.406A2.502 2.502 0 0 0 16 13.502V7.508a.75.75 0 0 0-.75-.75m-.75 6.744a.998.998 0 0 1-1.707.707 1 1 0 0 1 .707-1.706h1z"></path>';
const albumIcon = '<path d="M8 6.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3"></path><path d="M8 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6m0 1.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3"></path><path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8"></path>';
// Reuse Spotify+'s Copy icon in the host's leading icon slot.
const copySubmenuIcon = '<path d="M5 1.25h4.55c1 0 1.8.8 1.8 1.8V4.1H9.9V3.2a.45.45 0 0 0-.45-.45H5.2a.45.45 0 0 0-.45.45v6.1c0 .25.2.45.45.45h.95v1.45H5A1.7 1.7 0 0 1 3.3 9.5V2.95c0-.94.76-1.7 1.7-1.7m3.35 3.55h3.7c.91 0 1.65.74 1.65 1.65v6.25c0 .91-.74 1.65-1.65 1.65h-3.7c-.91 0-1.65-.74-1.65-1.65V6.45c0-.91.74-1.65 1.65-1.65m.1 1.4a.35.35 0 0 0-.35.35v5.95c0 .19.16.35.35.35h3.5a.35.35 0 0 0 .35-.35V6.55a.35.35 0 0 0-.35-.35zm.8 1.35h2.4V8.7h-2.4zm0 1.9h2.4V10.6h-2.4z"></path>';
const idIcon = '<path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M2.5 2.75h11A1.75 1.75 0 0 1 15.25 4.5v7a1.75 1.75 0 0 1-1.75 1.75h-11A1.75 1.75 0 0 1 .75 11.5v-7A1.75 1.75 0 0 1 2.5 2.75ZM4.75 6v4m3 0V6h1.5a2 2 0 0 1 0 4z"></path>';

function shareTarget(uris: string[]) {
  if (uris.length !== 1) return;
  try {
    const parsed = Spicetify.URI?.fromString(uris[0]);
    const canonical = /^spotify:([a-z]+):([^:]+)$/.exec(uris[0]);
    const type = parsed?.type.toLowerCase() ?? canonical?.[1];
    if (!type || !shareTypes.has(type)) return;
    const path = parsed?.toURLPath(true) || kit?.URI?.toUrl(uris[0]) ||
      (canonical && `/${type}/${encodeURIComponent(canonical[2])}`);
    if (!path) return;
    const url = new URL(path, "https://open.spotify.com");
    if (url.origin !== "https://open.spotify.com") return;
    url.search = "";
    url.hash = "";
    return { url: url.href, type };
  } catch {
    return undefined;
  }
}

function trackId(uris: string[]) {
  return uris.length === 1 ? /^spotify:track:([A-Za-z0-9]{22})$/.exec(uris[0])?.[1] : undefined;
}

async function copyText(value: string, notice: string) {
  try {
    const clipboard = Spicetify.Platform?.ClipboardAPI;
    if (clipboard?.copy) await clipboard.copy(value);
    else await navigator.clipboard.writeText(value);
    Spicetify.showNotification?.(notice);
  } catch {
    Spicetify.showNotification?.("Couldn’t copy to the clipboard", true);
  }
}

function itemLabel(item: HTMLElement) {
  return menuActionLabel(getMenuRowAction(item));
}

function rootMenu() {
  return Array.from(document.querySelectorAll<HTMLElement>(rootMenuSelector))
    .find(menu => isElementVisible(menu) && nativeShareItem(menuItems(menu)));
}

function menuItems(menu: HTMLElement) {
  return Array.from(menu.children).filter((node): node is HTMLElement => node instanceof HTMLElement && !!getMenuRowAction(node));
}

function nativeShareItem(items: HTMLElement[]) {
  const share = normalizeText(Spicetify.Locale?.get?.("contextmenu.share") || "Share");
  return items.find((item) => item.hasAttribute(nativeShareAttribute) || itemLabel(item) === share);
}

async function openEmbed(native?: HTMLElement) {
  const button = native && getMenuRowAction(native);
  if (native && button) {
    const encore = button.matches(encoreMenuRow);
    const submenu = button.hasAttribute("aria-expanded") || button.getAttribute("aria-haspopup") === "menu";
    if (submenu && button.getAttribute("aria-expanded") !== "true") {
      if (encore) openEncoreSubmenu(button, false);
      else button.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    }
    if (!submenu) button.click();
    const labels = [
      embedLabel,
      Spicetify.Locale?.get?.("share-dialog.destination.embed"),
      Spicetify.Locale?.get?.("share-dialog.destination.embed-code"),
    ].map(normalizeText).filter(Boolean);
    const matches = (element: HTMLElement) => {
      const label = normalizeText(element.getAttribute("aria-label")) || menuActionLabel(element);
      return labels.some((text) => label === text || label.startsWith(text + " "));
    };
    const deadline = Date.now() + 2000;
    let clicked = !submenu;
    while (button.isConnected && Date.now() < deadline) {
      const embed = encore && submenu
        ? [...(getEncoreSubmenu(button)?.querySelectorAll<HTMLElement>(encoreMenuRow) ?? [])].find(matches)
        : Array.from(native.querySelectorAll<HTMLElement>("[role='menu'] :is(button, a)")).find(matches)
        ?? Array.from(document.querySelectorAll<HTMLElement>(
          `:is([role='dialog'], [role='menu'][data-depth]:not([data-depth='0'])) :is(button, a, ${encoreMenuRow})`
        )).find((element) => isElementVisible(element) && matches(element));
      if (embed) {
        embed.click();
        return;
      }
      if (!clicked && Date.now() >= deadline - 1400) {
        clicked = true;
        if (button.getAttribute("aria-expanded") !== "true") {
          if (encore) openEncoreSubmenu(button, false);
          else button.click();
        }
      }
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
  }
  Spicetify.showNotification?.("Spotify’s Embed action is unavailable", true);
}

function forwardEmbed(event: Event) {
  if (event instanceof KeyboardEvent && (event.key !== "Enter" && event.key !== " ")) return;
  const button = event.target instanceof Element && event.target.closest<HTMLElement>(`${encoreMenuRow}, button, [role='menuitem']`);
  if (!button || menuActionLabel(button) !== normalizeText(customEmbedLabel)) return;
  const submenu = button.closest<HTMLElement>("[role='menu']");
  const menu = (submenu && getEncoreSubmenuTrigger(submenu)?.closest<HTMLElement>(rootMenuSelector)) ??
    button.closest<HTMLElement>(rootMenuSelector) ?? rootMenu();
  const native = menu && nativeShareItem(menuItems(menu));
  if (!native) return;
  // Keep the menu mounted until Spotify has rendered its native Embed action.
  event.preventDefault();
  event.stopImmediatePropagation();
  if (openingEmbed.has(button)) return;
  openingEmbed.add(button);
  void openEmbed(native).finally(() => openingEmbed.delete(button));
}

function syncMenu(menu: HTMLElement) {
  const items = menuItems(menu);
  const copy = items.find((item) => itemLabel(item) === normalizeText(copyLabel));
  const native = nativeShareItem(items);
  if (!copy && !native) return;
  const refined = getSetting("restoreOldShareMenu") && !!copy;
  if (copy) {
    const button = getMenuRowAction(copy);
    if (!button?.hasAttribute("role")) button?.setAttribute("role", "menuitem");
    if (copy.nextElementSibling !== (native ?? null)) menu.insertBefore(copy, native ?? null);
  }

  const first = copy ?? native;
  const existing = menu.querySelector<HTMLElement>(`:scope > [${dividerAttribute}]`);
  const previous = first?.previousElementSibling === existing ? existing?.previousElementSibling : first?.previousElementSibling;
  const hasNativeDivider = previous?.matches("div.main-contextMenu-dividerBefore, div.main-contextMenu-dividerAfter, [role='separator']");
  if (first && first !== native && previous && !hasNativeDivider) {
    const divider = existing ?? document.createElement("div");
    divider.className = "main-contextMenu-dividerBefore";
    divider.setAttribute(dividerAttribute, "");
    if (divider.nextElementSibling !== first) menu.insertBefore(divider, first);
  } else existing?.remove();

  if (native) {
    native.toggleAttribute(nativeShareAttribute, refined);
    toggleElementDisplay(native, refined);
  }
  if (refined || copy) useVisibleEncoreMenuOrder(menu);
  if (menu.matches(encoreMenu) && native && !menu.dataset.lyssnaShareShortcut) {
    menu.dataset.lyssnaShareShortcut = "true";
    menu.addEventListener("keydown", event => {
      const hidden = menu.querySelector<HTMLElement>(`:scope > [${nativeShareAttribute}]`);
      if (hidden?.getAttribute("aria-keyshortcuts")?.toLowerCase() !== event.key.toLowerCase() ||
          event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const copy = menuItems(menu).find(item => itemLabel(item) === normalizeText(copyLabel));
      const action = copy && getMenuRowAction(copy);
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      openEncoreSubmenu(action);
    }, true);
  }
}

function syncMenus() {
  for (const menu of document.querySelectorAll<HTMLElement>(rootMenuSelector)) {
    if (isElementVisible(menu)) syncMenu(menu);
  }
}

export function startShareMenuController(host: Host) {
  const showShare = (uris: string[]) => getSetting("restoreOldShareMenu") && !!shareTarget(uris);
  const copyCleanUrl = (uris: string[]) => {
    const target = shareTarget(uris);
    if (target) void copyText(target.url, "Clean URL copied");
  };
  const clean = createContextMenuItem(cleanLabel, copyCleanUrl, showShare, cleanIcon);
  const embed = createContextMenuItem(customEmbedLabel, () => {
    const menu = rootMenu();
    void openEmbed(menu && nativeShareItem(menuItems(menu)));
  }, (uris) => {
    const target = shareTarget(uris);
    return getSetting("restoreOldShareMenu") && !!target && !noEmbed.has(target.type);
  }, embedIcon);

  const showCopy = (uris: string[]) => getSetting("showTrackCopyMenu") && !!trackId(uris);
  async function copyTrackMetadata(uris: string[], kind: "song" | "isrc") {
    const id = trackId(uris);
    if (!id) return;
    const current = host.track();
    const playing = current?.id === id ? current : undefined;
    if (kind === "isrc") {
      const isrc = await host.lookupIsrc(id, playing?.isrc).catch(() => undefined);
      if (isrc) await copyText(isrc, "ISRC copied");
      else Spicetify.showNotification?.("No ISRC available for this track", true);
      return;
    }
    let value = playing?.title && playing.artists && `${playing.title} - ${playing.artists}`;
    if (!value) {
      const track = await host.lookupTrack(id).catch(() => undefined);
      if (track?.name && track.artists.length) {
        value = `${track.name} - ${track.artists.map(({ name }) => name).join(", ")}`;
      }
    }
    if (value) await copyText(value, "Song name and artist copied");
    else Spicetify.showNotification?.("Song details unavailable", true);
  }

  const actions = [
    { label: "Copy ID", icon: idIcon, copy: (uri: string) => {
      const id = trackId([uri]);
      if (id) void copyText(id, "Spotify ID copied");
    } },
    { label: "Copy ISRC", icon: albumIcon, copy: (uri: string) => void copyTrackMetadata([uri], "isrc") },
    { label: "Copy Song Name & Artist", icon: artistIcon, copy: (uri: string) => void copyTrackMetadata([uri], "song") },
  ];
  const copyItems = actions.map(({ label, copy, icon }) => createContextMenuItem(label, (uris) => {
    if (trackId(uris)) copy(uris[0]);
  }, showCopy, icon));
  createContextMenuSubMenu(copyLabel, [...copyItems, clean, embed], (uris) => showShare(uris) || showCopy(uris), copySubmenuIcon).register();

  document.addEventListener("contextmenu", resetMenuContext, true);
  document.addEventListener("click", forwardEmbed, true);
  document.addEventListener("keydown", forwardEmbed, true);
  const syncUnavailableMenu = startUnavailableTrackMenu([
    ...actions.map(action => ({ ...action, enabled: (uri: string) => showCopy([uri]) })),
    { label: cleanLabel, copy: uri => copyCleanUrl([uri]), enabled: uri => showShare([uri]) },
  ]);
  const sync = () => { syncMenus(); syncUnavailableMenu(); };
  observeMenus(sync);
  window.addEventListener(SETTINGS_CHANGED_EVENT, sync);
}
