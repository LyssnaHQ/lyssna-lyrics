import type { Host } from "./host";
import { hasLyssnaSession, subscribeLyssnaAccount } from "./lyssna-account";
import { clearActAs, readActAs, subscribeActAs, type ActAs } from "./lyssna-act-as";
import { lyssnaRequest } from "./lyssna-api";

const profileButton = '[data-testid="user-widget-link"]';
const stopIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';

export function uploadAsTopbar(host: Host) {
  let active: ActAs | undefined;
  let avatarUrl: string | undefined;
  let removeMenu: (() => void) | undefined;
  let expiry = 0;
  let badge: { button: HTMLElement; node: HTMLSpanElement; remove(): void } | undefined;

  function showAvatar(node: HTMLElement, url: string) {
    const image = document.createElement("img");
    image.alt = "";
    image.referrerPolicy = "no-referrer";
    image.hidden = true;
    image.addEventListener("load", () => { image.hidden = false; }, { once: true });
    image.src = url;
    node.append(image);
  }

  function sync() {
    if (!active || (badge?.button.isConnected && badge.node.parentElement === badge.button)) return;
    badge?.remove();
    badge = undefined;
    const button = document.querySelector<HTMLElement>(profileButton);
    if (!button) return;

    const label = `Uploading as ${active.username}`;
    const previousTitle = button.getAttribute("title");
    const previousDescription = button.getAttribute("aria-description");
    const node = document.createElement("span");
    node.className = "lyssna-upload-as-avatar";
    node.setAttribute("aria-hidden", "true");
    node.textContent = Array.from(active.username.trim())[0]?.toLocaleUpperCase() || "?";
    if (avatarUrl) showAvatar(node, avatarUrl);
    button.classList.add("lyssna-upload-as-profile");
    button.title = label;
    button.setAttribute("aria-description", label);
    button.append(node);
    badge = { button, node, remove() {
      node.remove();
      button.classList.remove("lyssna-upload-as-profile");
      for (const [name, previous] of [["title", previousTitle], ["aria-description", previousDescription]] as const) {
        if (button.getAttribute(name) !== label) continue;
        if (previous === null) button.removeAttribute(name);
        else button.setAttribute(name, previous);
      }
    } };
  }

  function update() {
    window.clearTimeout(expiry);
    const next = hasLyssnaSession() ? readActAs() : undefined;
    if (next) expiry = window.setTimeout(update, Math.max(1, next.until - Date.now() + 1));
    if (next?.id === active?.id && next?.username === active?.username) return;

    removeMenu?.();
    removeMenu = undefined;
    badge?.remove();
    badge = undefined;
    avatarUrl = undefined;
    active = next;
    if (!next) return;

    removeMenu = host.profileMenuItem(`Stop uploading as ${next.username}`, clearActAs, stopIcon);
    sync();
    void lyssnaRequest(`/v1/users/${encodeURIComponent(next.id)}`, { waitForInstall: true }).then(async response => {
      if (!response?.ok || active !== next) return;
      const profile = await response.json() as { avatar_url?: unknown } | null;
      const url = profile?.avatar_url;
      if (active !== next || typeof url !== "string" || !url.startsWith("https://")) return;
      avatarUrl = url;
      if (badge) showAvatar(badge.node, url);
    }).catch(() => {});
  }

  const stopActAs = subscribeActAs(update);
  const stopAccount = subscribeLyssnaAccount(update);
  update();
  return { sync, dispose() {
    stopActAs();
    stopAccount();
    window.clearTimeout(expiry);
    removeMenu?.();
    badge?.remove();
    active = undefined;
  } };
}
