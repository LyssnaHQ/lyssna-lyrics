export function normalizeText(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function isElementVisible(element: HTMLElement) {
  return !!(element.offsetParent || element.getClientRects().length);
}

export const encoreMenu = "[data-encore-id='menu'][role='menu']";
export const encoreMenuRow = "[data-encore-id='menuRow']";
export const rootMenuSelector = `[role='menu'][data-depth='0'], ${encoreMenu}:not([data-depth], [data-trigger='ContextMenuSubmenu'] *)`;

export function getMenuRowAction(row: HTMLElement) {
  return row.matches(encoreMenuRow) ? row : row.querySelector<HTMLElement>(
    ":scope > :is(.main-contextMenu-menuItemButton, button, a, [role='menuitem'], [role='menuitemcheckbox'])"
  );
}

export function menuActionLabel(action: HTMLElement | null) {
  return normalizeText(action?.querySelector(
    ".main-contextMenu-menuItemLabel, [data-encore-id='text'], [data-encore-id='type'], .TypeElement-type-mesto"
  )?.textContent ?? action?.textContent);
}

export function getEncoreSubmenuTrigger(menu: HTMLElement) {
  const label = menu.getAttribute("aria-labelledby") ??
    menu.closest("[data-trigger='ContextMenuSubmenu']")?.getAttribute("aria-labelledby");
  const trigger = label && menu.ownerDocument.getElementById(label);
  return trigger instanceof HTMLElement && trigger.matches(encoreMenuRow) ? trigger : null;
}

export function getEncoreSubmenu(trigger: HTMLElement) {
  const id = trigger.getAttribute("aria-controls");
  const controlled = id && trigger.ownerDocument.getElementById(id);
  if (controlled instanceof HTMLElement && controlled.matches(encoreMenu)) return controlled;
  return [...trigger.ownerDocument.querySelectorAll<HTMLElement>(encoreMenu)]
    .find(menu => getEncoreSubmenuTrigger(menu) === trigger && isElementVisible(menu));
}

export function openEncoreSubmenu(trigger: HTMLElement, focus = true) {
  if (focus) trigger.focus({ preventScroll: true });
  const key = getComputedStyle(trigger).direction === "rtl" ? "ArrowLeft" : "ArrowRight";
  trigger.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

// React Aria's collection order does not follow DOM moves or hidden rows.
const encoreNavigation = new WeakSet<HTMLElement>();
export function useVisibleEncoreMenuOrder(menu: HTMLElement, active = () => true) {
  if (!menu.matches(encoreMenu) || encoreNavigation.has(menu)) return;
  encoreNavigation.add(menu);
  menu.addEventListener("keydown", event => {
    if (!active() || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) ||
        event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.closest("[role='menu']") !== menu ||
        target.matches("input, textarea, [contenteditable='true']")) return;
    const rows = [...menu.querySelectorAll<HTMLElement>("[role^='menuitem']")].filter(row =>
      row.closest("[role='menu']") === menu &&
      !row.matches("[aria-disabled='true'], [data-disabled], :disabled") && isElementVisible(row));
    if (!rows.length) return;
    const index = rows.indexOf(target.closest<HTMLElement>("[role^='menuitem']") ?? target);
    let next = 0;
    if (event.key === "End") next = rows.length - 1;
    else if (event.key === "ArrowDown") next = (index + 1) % rows.length;
    else if (event.key === "ArrowUp") next = (index < 0 ? rows.length - 1 : index - 1 + rows.length) % rows.length;
    event.preventDefault();
    event.stopPropagation();
    rows[next].focus();
  }, true);
}

export function toggleElementDisplay(element: HTMLElement, hidden: boolean) {
  if (hidden) {
    if (!("spotifyPlusOriginalDisplay" in element.dataset)) {
      element.dataset.spotifyPlusOriginalDisplay = element.style.display || "";
      element.dataset.spotifyPlusOriginalDisplayPriority = element.style.getPropertyPriority("display");
    }
    if (element.style.display !== "none") element.style.display = "none";
    return;
  }

  if ("spotifyPlusOriginalDisplay" in element.dataset) {
    // Leave subsequent changes made by Spotify or other extensions alone.
    if (element.style.display === "none" && !element.style.getPropertyPriority("display")) {
      const original = element.dataset.spotifyPlusOriginalDisplay ?? "";
      if (original) {
        element.style.setProperty("display", original, element.dataset.spotifyPlusOriginalDisplayPriority ?? "");
      } else {
        element.style.removeProperty("display");
      }
    }
    delete element.dataset.spotifyPlusOriginalDisplay;
    delete element.dataset.spotifyPlusOriginalDisplayPriority;
  }
}
