import type { Host } from "../../host";
import { Spicetify } from "../compat";
import { getSetting, SETTINGS_CHANGED_EVENT } from "../config";
import {
  encoreMenu, encoreMenuRow, getEncoreSubmenu, getMenuRowAction, isElementVisible,
  menuActionLabel, normalizeText, openEncoreSubmenu, rootMenuSelector, toggleElementDisplay, useVisibleEncoreMenuOrder,
} from "../dom";
import { observeMenus } from "../observeMenus";
import { createContextMenuItem, createContextMenuSubMenu, resetMenuContext } from "./contextMenu";
import { startUnavailableTrackMenu } from "./unavailableTrackMenu";

const cleanLabel = "Copy Clean URL";
const embedLabel = "Embed";
const copyLabel = "Copy\u2063";
const nativeShareAttribute = "data-lyssna-native-share";
const dividerAttribute = "data-lyssna-share-divider";
const boundEmbedButtons = new WeakSet<HTMLElement>();
const openingEmbed = new WeakSet<HTMLElement>();
const shareTypes = new Set(["track", "album", "artist", "playlist", "show", "episode", "audiobook", "user", "concert", "venue"]);
const noEmbed = new Set(["user", "concert", "venue"]);

// Spotify's 16 px icons from the Share menu and track actions.
const copyIcon = '<path d="M5 .75A.75.75 0 0 1 5.75 0h9.5a.75.75 0 0 1 .75.75v10.5a.75.75 0 0 1-.75.75H12v-1.5h2.5v-9h-8V3H5z"></path><path d="M.75 4a.75.75 0 0 0-.75.75v10.5c0 .414.336.75.75.75h9.5a.75.75 0 0 0 .75-.75V4.75A.75.75 0 0 0 10.25 4zm.75 10.5v-9h8v9z"></path>';
const embedIcon = '<path d="M0 1.75A.75.75 0 0 1 .75 1h14.5a.75.75 0 0 1 .75.75v13.5a.75.75 0 0 1-.75.75H.75a.75.75 0 0 1-.75-.75zm1.5.75v12h13v-12z"></path><path d="M6.962 5.47a.75.75 0 0 1 0 1.06L4.992 8.5l1.97 1.97a.75.75 0 1 1-1.06 1.06L2.87 8.5 5.9 5.47a.75.75 0 0 1 1.061 0zm2.076 0a.75.75 0 0 0 0 1.06l1.97 1.97-1.97 1.97a.75.75 0 1 0 1.06 1.06L13.13 8.5 10.1 5.47a.75.75 0 0 0-1.06 0"></path>';

const artistIcon = '<path d="M11.757 2.987A4.36 4.36 0 0 0 7.618 0a4.36 4.36 0 0 0-4.139 2.987 5.5 5.5 0 0 0-.22 1.894 5.6 5.6 0 0 0 1.4 3.312l.125.152a.748.748 0 0 1-.2 1.128l-2.209 1.275A4.75 4.75 0 0 0 0 14.857v1.142h8.734A5.5 5.5 0 0 1 8.15 14.5H1.517a3.25 3.25 0 0 1 1.6-2.454l2.21-1.275a2.25 2.25 0 0 0 .6-3.386l-.128-.153a4.1 4.1 0 0 1-1.05-2.44A4 4 0 0 1 4.89 3.47a2.8 2.8 0 0 1 1.555-1.713 2.89 2.89 0 0 1 3.293.691c.265.296.466.644.589 1.022.12.43.169.876.144 1.322a4.12 4.12 0 0 1-1.052 2.44l-.127.153a2.24 2.24 0 0 0-.2 2.58c.338-.45.742-.845 1.2-1.173 0-.162.055-.32.156-.447l.126-.152a5.6 5.6 0 0 0 1.4-3.312 5.5 5.5 0 0 0-.218-1.894zm3.493 3.771a.75.75 0 0 0-.75.75v3.496h-1a2.5 2.5 0 0 0-2.31 1.542 2.497 2.497 0 0 0 1.822 3.406A2.502 2.502 0 0 0 16 13.502V7.508a.75.75 0 0 0-.75-.75m-.75 6.744a.998.998 0 0 1-1.707.707 1 1 0 0 1 .707-1.706h1z"></path>';
const albumIcon = '<path d="M8 6.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3"></path><path d="M8 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6m0 1.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3"></path><path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8"></path>';
// Reuse Spotify+'s Copy icon in the host's leading icon slot.
const copySubmenuIcon = '<path d="M5 1.25h4.55c1 0 1.8.8 1.8 1.8V4.1H9.9V3.2a.45.45 0 0 0-.45-.45H5.2a.45.45 0 0 0-.45.45v6.1c0 .25.2.45.45.45h.95v1.45H5A1.7 1.7 0 0 1 3.3 9.5V2.95c0-.94.76-1.7 1.7-1.7m3.35 3.55h3.7c.91 0 1.65.74 1.65 1.65v6.25c0 .91-.74 1.65-1.65 1.65h-3.7c-.91 0-1.65-.74-1.65-1.65V6.45c0-.91.74-1.65 1.65-1.65m.1 1.4a.35.35 0 0 0-.35.35v5.95c0 .19.16.35.35.35h3.5a.35.35 0 0 0 .35-.35V6.55a.35.35 0 0 0-.35-.35zm.8 1.35h2.4V8.7h-2.4zm0 1.9h2.4V10.6h-2.4z"></path>';
const idIcon = '<path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M2.5 2.75h11A1.75 1.75 0 0 1 15.25 4.5v7a1.75 1.75 0 0 1-1.75 1.75h-11A1.75 1.75 0 0 1 .75 11.5v-7A1.75 1.75 0 0 1 2.5 2.75ZM4.75 6v4m3 0V6h1.5a2 2 0 0 1 0 4z"></path>';

function shareTarget(uris: string[]) {
  if (uris.length !== 1) return;
  try {
    const parsed = Spicetify.URI?.fromString(uris[0]);
    const type = parsed?.type.toLowerCase();
    if (!parsed || !type || !shareTypes.has(type)) return;
    const url = new URL(parsed.toURLPath(true), "https://open.spotify.com");
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
  const button = event.currentTarget as HTMLElement;
  const menu = button.closest<HTMLElement>(rootMenuSelector);
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
  const clean = items.find((item) => itemLabel(item) === normalizeText(cleanLabel));
  const embed = items.find((item) => itemLabel(item) === normalizeText(embedLabel));
  if (!copy && !native && !clean && !embed) return;
  const refined = getSetting("restoreOldShareMenu") && !!clean;
  const embedButton = embed && getMenuRowAction(embed);
  if (embedButton && !boundEmbedButtons.has(embedButton)) {
    embedButton.addEventListener("click", forwardEmbed, true);
    if (embedButton.matches(encoreMenuRow)) {
      embedButton.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") forwardEmbed(event);
      }, true);
    }
    boundEmbedButtons.add(embedButton);
  }

  let first = native ?? null;
  for (const item of [refined ? embed : undefined, refined ? clean : undefined, copy]) {
    if (!item) continue;
    const button = getMenuRowAction(item);
    if (!button?.hasAttribute("role")) button?.setAttribute("role", "menuitem");
    if (item.nextElementSibling !== first) menu.insertBefore(item, first);
    first = item;
  }

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
      const clean = menuItems(menu).find(item => itemLabel(item) === normalizeText(cleanLabel));
      const action = clean && getMenuRowAction(clean);
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      action.click();
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
  createContextMenuItem(cleanLabel, (uris) => {
    const target = shareTarget(uris);
    if (target) void copyText(target.url, "Clean URL copied");
  }, showShare, copyIcon).register();
  createContextMenuItem(embedLabel, () => {
    const menu = rootMenu();
    void openEmbed(menu && nativeShareItem(menuItems(menu)));
  }, (uris) => {
    const target = shareTarget(uris);
    return getSetting("restoreOldShareMenu") && !!target && !noEmbed.has(target.type);
  }, embedIcon).register();

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
    { label: "Copy Song Name & Artist", icon: artistIcon, copy: (uri: string) => void copyTrackMetadata([uri], "song") },
    { label: "Copy ISRC", icon: albumIcon, copy: (uri: string) => void copyTrackMetadata([uri], "isrc") },
  ];
  const copyItems = actions.map(({ label, copy, icon }) => createContextMenuItem(label, (uris) => {
    if (trackId(uris)) copy(uris[0]);
  }, showCopy, icon));
  createContextMenuSubMenu(copyLabel, copyItems, showCopy, copySubmenuIcon).register();

  document.addEventListener("contextmenu", resetMenuContext, true);
  const syncUnavailableMenu = startUnavailableTrackMenu(actions);
  const sync = () => { syncMenus(); syncUnavailableMenu(); };
  observeMenus(sync);
  window.addEventListener(SETTINGS_CHANGED_EVENT, sync);
}
