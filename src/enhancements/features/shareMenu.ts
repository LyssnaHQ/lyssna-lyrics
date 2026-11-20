import type { Host } from "../../host";
import { Spicetify } from "../compat";
import { getSetting, SETTINGS_CHANGED_EVENT } from "../config";
import { isElementVisible, normalizeText, toggleElementDisplay } from "../dom";
import { observeMenus } from "../observeMenus";
import { createContextMenuItem, createContextMenuSubMenu, resetMenuContext } from "./contextMenu";

const cleanLabel = "Copy Clean URL";
const embedLabel = "Embed";
const copyLabel = "Copy\u2063";
const nativeShareAttribute = "data-lyssna-native-share";
const dividerAttribute = "data-lyssna-share-divider";
const boundEmbedButtons = new WeakSet<HTMLElement>();
const shareTypes = new Set(["track", "album", "artist", "playlist", "show", "episode", "audiobook", "user", "concert", "venue"]);
const noEmbed = new Set(["user", "concert", "venue"]);

// Spotify's 16 px Copy link and Embed icons from its Share submenu.
const copyIcon = '<path d="M5 .75A.75.75 0 0 1 5.75 0h9.5a.75.75 0 0 1 .75.75v10.5a.75.75 0 0 1-.75.75H12v-1.5h2.5v-9h-8V3H5z"></path><path d="M.75 4a.75.75 0 0 0-.75.75v10.5c0 .414.336.75.75.75h9.5a.75.75 0 0 0 .75-.75V4.75A.75.75 0 0 0 10.25 4zm.75 10.5v-9h8v9z"></path>';
const embedIcon = '<path d="M0 1.75A.75.75 0 0 1 .75 1h14.5a.75.75 0 0 1 .75.75v13.5a.75.75 0 0 1-.75.75H.75a.75.75 0 0 1-.75-.75zm1.5.75v12h13v-12z"></path><path d="M6.962 5.47a.75.75 0 0 1 0 1.06L4.992 8.5l1.97 1.97a.75.75 0 1 1-1.06 1.06L2.87 8.5 5.9 5.47a.75.75 0 0 1 1.061 0zm2.076 0a.75.75 0 0 0 0 1.06l1.97 1.97-1.97 1.97a.75.75 0 1 0 1.06 1.06L13.13 8.5 10.1 5.47a.75.75 0 0 0-1.06 0"></path>';

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

function menuButton(item: HTMLElement) {
  return item.querySelector<HTMLElement>(":scope > :is(button, a, [role='menuitem'])");
}

function itemLabel(item: HTMLElement) {
  const button = menuButton(item);
  const label = button?.querySelector(".main-contextMenu-menuItemLabel, [data-encore-id='text'], [data-encore-id='type']");
  return normalizeText(label?.textContent || button?.textContent);
}

const rootSelector = "[role='menu'][data-depth='0']";

function rootMenu() {
  return Array.from(document.querySelectorAll<HTMLElement>(rootSelector)).find(isElementVisible);
}

function menuItems(menu: HTMLElement) {
  return Array.from(menu.children).filter((node): node is HTMLElement => node instanceof HTMLElement && !!menuButton(node));
}

function nativeShareItem(items: HTMLElement[]) {
  const share = normalizeText(Spicetify.Locale?.get?.("contextmenu.share") || "Share");
  return items.find((item) => item.hasAttribute(nativeShareAttribute) || itemLabel(item) === share);
}

async function openEmbed(native?: HTMLElement) {
  const button = native && menuButton(native);
  if (native && button) {
    const submenu = button.hasAttribute("aria-expanded");
    if (submenu && button.getAttribute("aria-expanded") !== "true") {
      button.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    }
    if (!submenu) button.click();
    const labels = [
      embedLabel,
      Spicetify.Locale?.get?.("share-dialog.destination.embed"),
      Spicetify.Locale?.get?.("share-dialog.destination.embed-code"),
    ].map(normalizeText).filter(Boolean);
    const matches = (element: HTMLElement) => {
      const label = normalizeText(element.getAttribute("aria-label") ?? element.textContent);
      return labels.some((text) => label === text || label.startsWith(text + " "));
    };
    const deadline = Date.now() + 2000;
    let clicked = !submenu;
    while (Date.now() < deadline) {
      const embed = Array.from(native.querySelectorAll<HTMLElement>("[role='menu'] :is(button, a)")).find(matches)
        ?? Array.from(document.querySelectorAll<HTMLElement>(
          ":is([role='dialog'], [role='menu'][data-depth]:not([data-depth='0'])) :is(button, a)"
        )).find((element) => isElementVisible(element) && matches(element));
      if (embed) {
        embed.click();
        return;
      }
      if (!clicked && Date.now() >= deadline - 1400) {
        clicked = true;
        if (button.isConnected && button.getAttribute("aria-expanded") !== "true") button.click();
      }
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
  }
  Spicetify.showNotification?.("Spotify’s Embed action is unavailable", true);
}

function forwardEmbed(event: Event) {
  const menu = (event.currentTarget as HTMLElement).closest<HTMLElement>(rootSelector);
  const native = menu && nativeShareItem(menuItems(menu));
  if (!native) return;
  // Keep the menu mounted until Spotify has rendered its native Embed action.
  event.preventDefault();
  event.stopImmediatePropagation();
  void openEmbed(native);
}

function syncMenus() {
  const menu = rootMenu();
  if (!menu) return;
  const items = menuItems(menu);
  const copy = items.find((item) => itemLabel(item) === normalizeText(copyLabel));
  const native = nativeShareItem(items);
  const clean = items.find((item) => itemLabel(item) === normalizeText(cleanLabel));
  const embed = items.find((item) => itemLabel(item) === normalizeText(embedLabel));
  const refined = getSetting("restoreOldShareMenu") && !!clean;
  const embedButton = embed && menuButton(embed);
  if (embedButton && !boundEmbedButtons.has(embedButton)) {
    embedButton.addEventListener("click", forwardEmbed, true);
    boundEmbedButtons.add(embedButton);
  }

  let first = native ?? null;
  for (const item of [refined ? embed : undefined, refined ? clean : undefined, copy]) {
    if (!item) continue;
    const button = menuButton(item);
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
    const local = kind === "song" ? playing?.title && playing.artists && `${playing.title} - ${playing.artists}` : playing?.isrc;
    let value = local;
    if (!value) {
      const track = await host.lookupTrack(id).catch(() => undefined);
      if (kind === "song" && track?.name && track.artists.length) {
        value = `${track.name} - ${track.artists.map(({ name }) => name).join(", ")}`;
      } else if (kind === "isrc") {
        value = track?.external_ids?.isrc;
      }
    }
    if (value) await copyText(value, kind === "song" ? "Song name and artist copied" : "ISRC copied");
    else Spicetify.showNotification?.(kind === "song" ? "Song details unavailable" : "No ISRC available for this track", true);
  }

  const copyItems = [
    createContextMenuItem("Copy ID", (uris) => {
      const id = trackId(uris);
      if (id) void copyText(id, "Spotify ID copied");
    }, showCopy, copyIcon),
    createContextMenuItem("Copy Song Name & Artist", (uris) => void copyTrackMetadata(uris, "song"), showCopy, Spicetify.SVGIcons?.credits ?? copyIcon),
    createContextMenuItem("Copy ISRC", (uris) => void copyTrackMetadata(uris, "isrc"), showCopy, copyIcon),
  ];
  createContextMenuSubMenu(copyLabel, copyItems, showCopy, copyIcon).register();

  document.addEventListener("contextmenu", resetMenuContext, true);
  observeMenus(syncMenus);
  window.addEventListener(SETTINGS_CHANGED_EVENT, syncMenus);
}
