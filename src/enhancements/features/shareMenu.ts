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
const shareTypes = new Set(["track", "album", "artist", "playlist", "show", "episode", "audiobook", "user", "concert", "venue"]);
const noEmbed = new Set(["user", "concert", "venue"]);

function menuIcon(path: string) {
  return `<path fill="currentColor" d="${path}"></path>`;
}

const copyIcon = Spicetify.SVGIcons?.copy ?? menuIcon("M5 1h9a1 1 0 0 1 1 1v9h-1.5V2.5H5zm-3 3h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1m.5 1.5v8h8v-8z");
const linkIcon = menuIcon("M9.6 1.6a3.4 3.4 0 1 1 4.8 4.8l-2.2 2.2-1.06-1.06 2.2-2.2a1.9 1.9 0 0 0-2.68-2.68l-2.2 2.2L7.4 3.8zm-5.8 5.8L4.86 8.46l-2.2 2.2a1.9 1.9 0 1 0 2.68 2.68l2.2-2.2L8.6 12.2l-2.2 2.2a3.4 3.4 0 1 1-4.8-4.8zm1.17 2.57 5-5 1.06 1.06-5 5z");
const embedIcon = menuIcon("M5.53 2.47a.75.75 0 0 1 0 1.06L2.06 8l3.47 3.47a.75.75 0 1 1-1.06 1.06L.47 8l4-4a.75.75 0 0 1 1.06 0m4.94 0a.75.75 0 0 1 1.06 0l4 4-4 4a.75.75 0 1 1-1.06-1.06L13.94 8l-3.47-3.47a.75.75 0 0 1 0-1.06");
const idIcon = menuIcon("M5.4 1h1.5l-.7 4h4l.7-4h1.5l-.7 4H15v1.5h-3.6l-.53 3H14V11h-3.4l-.7 4H8.4l.7-4h-4l-.7 4H2.9l.7-4H1V9.5h2.87l.53-3H2V5h2.66zm.54 5.5-.54 3h4l.54-3z");
const songIcon = menuIcon("M6 3v8.5a2.75 2.75 0 1 1-1.5-2.45V3a1 1 0 0 1 .79-.98L14 0v3.5L6 5.27zm-1.5 8.5a1.25 1.25 0 1 0-2.5 0 1.25 1.25 0 0 0 2.5 0M8 8h7v1.5H8zm0 3h7v1.5H8z");
const barcodeIcon = menuIcon("M1 2h1.5v12H1zm3 0h2v12H4zm3.5 0H9v12H7.5zm3 0h1.5v12h-1.5zm3 0H15v12h-1.5z");

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
  return item.querySelector<HTMLElement>(":scope > [role='menuitem']");
}

function itemLabel(item: HTMLElement) {
  const button = menuButton(item);
  const label = button?.querySelector(".main-contextMenu-menuItemLabel, [data-encore-id='text'], [data-encore-id='type']");
  return normalizeText(label?.textContent || button?.textContent);
}

function rootItems() {
  const menu = Array.from(document.querySelectorAll<HTMLElement>("[role='menu'][data-depth='0']"))
    .find(isElementVisible);
  return menu ? Array.from(menu.children).filter((node): node is HTMLElement =>
    node instanceof HTMLElement && !!menuButton(node)) : [];
}

function nativeShareItem(items: HTMLElement[]) {
  const share = normalizeText(Spicetify.Locale?.get?.("contextmenu.share") || "Share");
  return items.find((item) => item.hasAttribute(nativeShareAttribute) || itemLabel(item) === share);
}

async function openEmbed() {
  const native = nativeShareItem(rootItems());
  const button = native && menuButton(native);
  if (button) {
    button.click();
    const labels = [
      embedLabel,
      Spicetify.Locale?.get?.("share-dialog.destination.embed"),
      Spicetify.Locale?.get?.("share-dialog.destination.embed-code"),
    ].map(normalizeText).filter(Boolean);
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      const embed = Array.from(document.querySelectorAll<HTMLElement>(
        ":is([role='dialog'], [role='menu'][data-depth]:not([data-depth='0'])) :is(button, [role='menuitem'], a)"
      )).find((element) => {
        const label = normalizeText(element.getAttribute("aria-label") ?? element.textContent);
        return labels.some((text) => label === text || label.startsWith(text + " ")) && isElementVisible(element);
      });
      if (embed) {
        embed.click();
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
  }
  Spicetify.showNotification?.("Spotify’s Embed action is unavailable", true);
}

function syncMenus() {
  const items = rootItems();
  const copy = items.find((item) => itemLabel(item) === normalizeText(copyLabel));
  if (copy && items[0] !== copy) copy.parentElement?.insertBefore(copy, items[0]);

  const native = nativeShareItem(items);
  if (!native) return;
  const clean = items.find((item) => itemLabel(item) === normalizeText(cleanLabel));
  if (!clean || !getSetting("restoreOldShareMenu")) {
    toggleElementDisplay(native, false);
    native.removeAttribute(nativeShareAttribute);
    return;
  }

  const embed = items.find((item) => itemLabel(item) === normalizeText(embedLabel));
  if (embed && embed.nextElementSibling !== native) native.parentElement?.insertBefore(embed, native);
  const anchor = embed ?? native;
  if (clean.nextElementSibling !== anchor) native.parentElement?.insertBefore(clean, anchor);
  native.setAttribute(nativeShareAttribute, "");
  toggleElementDisplay(native, true);
}

export function startShareMenuController(host: Host) {
  const showShare = (uris: string[]) => getSetting("restoreOldShareMenu") && !!shareTarget(uris);
  createContextMenuItem(cleanLabel, (uris) => {
    const target = shareTarget(uris);
    if (target) void copyText(target.url, "Clean URL copied");
  }, showShare, linkIcon).register();
  createContextMenuItem(embedLabel, () => void openEmbed(), (uris) => {
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
    }, showCopy, idIcon),
    createContextMenuItem("Copy Song Name & Artist", (uris) => void copyTrackMetadata(uris, "song"), showCopy, songIcon),
    createContextMenuItem("Copy ISRC", (uris) => void copyTrackMetadata(uris, "isrc"), showCopy, barcodeIcon),
  ];
  createContextMenuSubMenu(copyLabel, copyItems, showCopy, copyIcon).register();

  document.addEventListener("contextmenu", resetMenuContext, true);
  observeMenus(syncMenus);
  window.addEventListener(SETTINGS_CHANGED_EVENT, syncMenus);
}
