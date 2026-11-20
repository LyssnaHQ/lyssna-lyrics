import { getSettings, SETTINGS_CHANGED_EVENT, type EnhancementKey } from "../config";
import { normalizeText, toggleElementDisplay } from "../dom";
import { observeMenus } from "../observeMenus";

const items: [string, EnhancementKey][] = [
  ["home config", "hideHomeConfigMenuItem"], ["account", "hideAccountMenuItem"],
  ["profile", "hideProfileMenuItem"], ["recents", "hideRecentsMenuItem"],
  ["support", "hideSupportMenuItem"], ["private session", "hidePrivateSessionMenuItem"], ["log out", "hideLogOutMenuItem"],
];

function apply() {
  const settings = getSettings();
  for (const menu of document.querySelectorAll<HTMLElement>("#context-menu [role='menu'], [role='menu'][data-depth='0']")) {
    const labels = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemcheckbox"]')];
    const labelOf = (item: HTMLElement) => normalizeText(item.querySelector(".main-contextMenu-menuItemLabel, [data-encore-id='text']")?.textContent ?? item.textContent);
    if (!labels.some(item => labelOf(item) === "settings") || !labels.some(item => items.some(([label]) => labelOf(item) === label))) continue;
    for (const item of labels) {
      const setting = items.find(([label]) => labelOf(item) === label);
      if (setting) toggleElementDisplay(item.closest<HTMLElement>('[role="presentation"]') ?? item, settings[setting[1]] === true);
    }
    for (const child of [...menu.children] as HTMLElement[]) {
      const updates = [...child.querySelectorAll("[data-encore-id='text'], h2, h3")].some(node => normalizeText(node.textContent) === "your updates");
      if (updates) toggleElementDisplay(child, settings.hideYourUpdatesSection);
    }
    const children = [...menu.children] as HTMLElement[];
    for (const child of children) {
      const divider = child.matches("[role='separator'], .main-contextMenu-dividerAfter, .main-contextMenu-dividerBefore");
      if (!divider) continue;
      const index = children.indexOf(child);
      const visible = (node: HTMLElement) => node.style.display !== "none";
      const before = children.slice(0, index).reverse().find(visible);
      const after = children.slice(index + 1).find(visible);
      toggleElementDisplay(child, !before || !after || before.getAttribute("role") === "separator");
    }
  }
}

export function startProfileMenuController() {
  observeMenus(apply);
  window.addEventListener(SETTINGS_CHANGED_EVENT, apply);
  apply();
}
