import { getSettings, SETTINGS_CHANGED_EVENT, type EnhancementKey } from "../config";
import { getMenuRowAction, menuActionLabel, normalizeText, rootMenuSelector, toggleElementDisplay, useVisibleEncoreMenuOrder } from "../dom";
import { observeMenus } from "../observeMenus";

const items = new Map<string, EnhancementKey>([
  ["home config", "hideHomeConfigMenuItem"], ["account", "hideAccountMenuItem"],
  ["profile", "hideProfileMenuItem"], ["recents", "hideRecentsMenuItem"],
  ["support", "hideSupportMenuItem"], ["private session", "hidePrivateSessionMenuItem"], ["log out", "hideLogOutMenuItem"],
]);

const profileMenuReady = "data-lyssna-profile-ready";

function apply() {
  const settings = getSettings();
  const hidingEntries = settings.hideYourUpdatesSection || [...items.values()].some(key => settings[key] === true);
  document.documentElement.classList.toggle("ll-enhancements-profile-cleanup", hidingEntries);

  for (const menu of document.querySelectorAll<HTMLElement>(`#context-menu [role='menu'], ${rootMenuSelector}`)) {
    const children = [...menu.children] as HTMLElement[];
    const rows = children.map(row => ({
      row,
      action: row.matches("[data-encore-id='menuSection']") ? null : getMenuRowAction(row),
    }));
    const hasSettings = rows.some(({ action }) => action?.getAttribute("href") === "/preferences" || menuActionLabel(action) === "settings");
    if (!hasSettings) continue;

    const configuredRows = rows.map(({ row, action }) => {
      const href = action?.getAttribute("href");
      const label = href?.startsWith("/user/") ? "profile" :
        href === "/recents" ? "recents" :
        href?.startsWith("https://support.spotify.com/") ? "support" :
        menuActionLabel(action);
      return { row, action, setting: items.get(label) };
    });
    let modified = false;
    for (const { row, action, setting } of configuredRows) {
      if (setting) {
        const hidden = settings[setting] === true;
        toggleElementDisplay(row, hidden);
        modified ||= hidden;
      } else if (!action) {
        const sectionHeader = row.querySelector(":scope > [data-encore-id='menuSectionHeader']");
        const updates = sectionHeader
          ? normalizeText(sectionHeader.textContent) === "your updates"
          : [...row.querySelectorAll("[data-encore-id='text'], h2, h3")]
            .some(node => normalizeText(node.textContent) === "your updates");
        if (updates) {
          toggleElementDisplay(row, settings.hideYourUpdatesSection);
          modified ||= settings.hideYourUpdatesSection;
        }
      }
    }
    menu.toggleAttribute("data-lyssna-profile-tweaks", modified);
    if (modified) useVisibleEncoreMenuOrder(menu, () => menu.hasAttribute("data-lyssna-profile-tweaks"));

    const divider = (node: Element) => node.matches("[role='separator'], .main-contextMenu-dividerAfter, .main-contextMenu-dividerBefore");
    let afterRow = false;
    for (const child of children) {
      if (!divider(child)) {
        if (child.style.display !== "none") afterRow = true;
        continue;
      }
      const hasFollowingRow = children.slice(children.indexOf(child) + 1)
        .some(node => !divider(node) && node.style.display !== "none");
      toggleElementDisplay(child, !afterRow || !hasFollowingRow);
      afterRow = false;
    }
    menu.setAttribute(profileMenuReady, "");
  }
}

export function startProfileMenuController() {
  observeMenus(apply);
  window.addEventListener(SETTINGS_CHANGED_EVENT, apply);
  apply();
}
