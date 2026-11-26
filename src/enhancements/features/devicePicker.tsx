import { Spicetify } from "../compat";
import type { Host, Root } from "../../host";
import { DeviceIcon, type DeviceKind, type Platform } from "../device-icons";
type ConnectDevice = {
  id: string;
  name?: string;
  type?: string;
  platform?: string;
  isGroup?: boolean;
  [key: string]: unknown;
};

import { SETTINGS_CHANGED_EVENT, getSettings } from "../config";

const CONNECT_BUTTON_SELECTOR =
  'button[aria-label="Connect to a device"], button[data-restore-focus-key="device_picker"]';
const CONNECT_BAR_TEXT_SELECTOR =
  ".main-connectBar-connected .main-connectBar-textButton";
const CONNECT_SIDEBAR_SELECTOR = 'aside[aria-label="Connect to a device"]';
const CONNECT_TOOLTIP_LABEL = "Connect to a device";
const CONNECT_PROXY_SELECTOR = 'button[data-spotify-plus-device-picker-proxy="true"]';

let popupRoot: HTMLDivElement | null = null;
let popupContents: Root | null = null;
let popupButton: HTMLElement | null = null;
let managedTooltipRoot: HTMLDivElement | null = null;
let managedTooltipButton: HTMLElement | null = null;
let openRefreshHandle = 0;
let isOpening = false;

function isEnabled() {
  return getSettings().restoreOldDevicePicker;
}

function getConnectDevicesApi() {
  return Spicetify.Platform?.ConnectDevicesAPI as
    | {
        getDevices?: () => Promise<ConnectDevice[]>;
        getActiveDevice?: () => Promise<ConnectDevice | null>;
      }
    | undefined;
}

function getConnectTransferApi() {
  return (
    (Spicetify.Platform?.ConnectAPI as
      | {
          transferPlayback?: (deviceId: string, loggingParams?: Record<string, unknown>) => Promise<void>;
        }
      | undefined) ??
    (Spicetify.Platform?.ConnectTransferAPI as
      | {
          transferPlayback?: (deviceId: string, loggingParams?: Record<string, unknown>) => Promise<void>;
        }
      | undefined)
  );
}

function isConnectSidebar(element: Element) {
  return element.matches(CONNECT_SIDEBAR_SELECTOR);
}

function hideConnectSidebar() {
  const sidebars = Array.from(document.querySelectorAll<HTMLElement>(CONNECT_SIDEBAR_SELECTOR));
  for (const sidebar of sidebars) {
    sidebar.style.display = "none";
  }
}

function showConnectSidebar() {
  const sidebars = Array.from(document.querySelectorAll<HTMLElement>(CONNECT_SIDEBAR_SELECTOR));
  for (const sidebar of sidebars) {
    if (sidebar.style.display === "none") {
      sidebar.style.display = "";
    }
  }
}

function isConnectTooltipRoot(element: Element) {
  if (!element.matches("[data-tippy-root]")) {
    return false;
  }

  const tooltip = element.querySelector<HTMLElement>('[role="tooltip"]');
  return tooltip?.textContent?.trim() === CONNECT_TOOLTIP_LABEL;
}

function hideConnectTooltips() {
  const tooltipRoots = Array.from(
    document.querySelectorAll<HTMLElement>("[data-tippy-root]")
  ).filter((element) => isConnectTooltipRoot(element));

  for (const tooltipRoot of tooltipRoots) {
    tooltipRoot.style.display = "none";
    window.setTimeout(() => {
      tooltipRoot.remove();
    }, 0);
  }
}

const deviceKinds = new Map<string, DeviceKind>([
  ["computer", "computer"], ["desktop", "desktop"], ["phone", "phone"], ["smartphone", "phone"],
  ["tablet", "tablet"], ["tv", "tv"], ["stb", "tv"], ["castvideo", "tv"], ["avr", "receiver"],
  ["receiver", "receiver"], ["gameconsole", "console"], ["console", "console"], ["automobile", "car"],
  ["carthing", "car"], ["car", "car"], ["smartwatch", "watch"], ["watch", "watch"], ["castaudio", "cast"],
  ["audiodongle", "cast"], ["cast", "cast"], ["alexa", "alexa"], ["group", "group"], ["speaker", "speaker"],
]);
const platforms = new Set<string>(["windows", "mac", "linux", "android", "playstation", "xbox"]);

function PickerIcon({ device, fallback }: { device?: ConnectDevice | null; fallback?: SVGElement | null }) {
  const type = device?.type?.toLowerCase().replace(/[\s_-]/g, "") ?? "";
  const name = device?.name ?? "";
  const kind = device?.isGroup ? "group"
    : /\b(echo|alexa)\b/i.test(name) ? "alexa" : deviceKinds.get(type);
  const platform = device?.platform?.toLowerCase() ?? "";
  if (kind && device?.id !== "local_device") {
    return <DeviceIcon kind={kind} platform={platforms.has(platform) ? platform as Platform : ""} size={24} />;
  }
  return <span className="SpotifyPlusDevicePickerDefaultIcon" aria-hidden="true" ref={(node) => {
    if (node && fallback) node.replaceChildren(fallback.cloneNode(true));
  }} />;
}

function getDeviceLabel(device: ConnectDevice | null | undefined) {
  if (!device) return "This computer";
  if (device.id === "local_device") {
    return "This computer";
  }
  return device.name ?? "Unknown device";
}

function setButtonOpenState(button: HTMLElement, open: boolean) {
  button.classList.toggle("main-genericButton-buttonActive", open);
  button.classList.toggle("main-genericButton-buttonActiveDot", open);
  button.setAttribute("aria-pressed", open ? "true" : "false");
  button.dataset.spotifyPlusDevicePickerOpen = open ? "true" : "false";

  if (open) {
    button.removeAttribute("aria-label");
    button.removeAttribute("title");
    button.removeAttribute("aria-describedby");
    hideManagedTooltip();
    return;
  }

  button.setAttribute("aria-label", CONNECT_TOOLTIP_LABEL);
  hideManagedTooltip();
}

function positionManagedTooltip() {
  if (!managedTooltipRoot || !managedTooltipButton?.isConnected) {
    hideManagedTooltip();
    return;
  }

  const buttonRect = managedTooltipButton.getBoundingClientRect();
  const tooltipRect = managedTooltipRoot.getBoundingClientRect();
  const gap = 10;
  const left = Math.min(
    window.innerWidth - tooltipRect.width - 8,
    Math.max(8, buttonRect.left + buttonRect.width / 2 - tooltipRect.width / 2)
  );
  const top = Math.max(8, buttonRect.top - tooltipRect.height - gap);

  managedTooltipRoot.style.left = `${left}px`;
  managedTooltipRoot.style.top = `${top}px`;
}

function showManagedTooltip(button: HTMLElement) {
  if (button.dataset.spotifyPlusDevicePickerOpen === "true") {
    return;
  }

  if (!managedTooltipRoot) {
    managedTooltipRoot = document.createElement("div");
    managedTooltipRoot.className = "SpotifyPlusManagedDeviceTooltipRoot";
    managedTooltipRoot.setAttribute("data-tippy-root", "");
    managedTooltipRoot.style.pointerEvents = "none";
    managedTooltipRoot.style.zIndex = "9999";
    managedTooltipRoot.style.position = "fixed";
    managedTooltipRoot.style.inset = "0 auto auto 0";
    managedTooltipRoot.style.margin = "0";
    managedTooltipRoot.innerHTML = `
      <div id="context-menu" data-placement="top">
        <div class="main-contextMenu-tippy">
          <span id="hover-or-focus-tooltip" role="tooltip">${CONNECT_TOOLTIP_LABEL}</span>
        </div>
      </div>
    `;
    document.body.appendChild(managedTooltipRoot);
  }

  managedTooltipButton = button;
  positionManagedTooltip();
}

function hideManagedTooltip() {
  managedTooltipRoot?.remove();
  managedTooltipRoot = null;
  managedTooltipButton = null;
}

function createManagedButton(sourceButton: HTMLElement, host: Host) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.spotifyPlusDevicePickerProxy = "true";
  button.dataset.encoreId = sourceButton.getAttribute("data-encore-id") ?? "buttonTertiary";
  button.className = sourceButton.className;
  button.innerHTML = sourceButton.innerHTML;

  button.style.position = "relative";
  button.style.overflow = "visible";

  setButtonOpenState(button, false);
  button.addEventListener("mouseover", () => {
    showManagedTooltip(button);
  });
  button.addEventListener("mouseout", () => {
    hideManagedTooltip();
  });
  button.addEventListener("focus", () => {
    showManagedTooltip(button);
  });
  button.addEventListener("blur", () => {
    hideManagedTooltip();
  });
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    hideManagedTooltip();
    void openDevicePicker(button, host);
  });
  return button;
}

function installManagedButton(sourceButton: HTMLElement, host: Host) {
  if (sourceButton.dataset.spotifyPlusDevicePickerManaged === "true") {
    return;
  }

  const parent = sourceButton.parentElement;
  if (!parent) {
    return;
  }

  const managedButton = createManagedButton(sourceButton, host);
  sourceButton.dataset.spotifyPlusDevicePickerManaged = "true";
  sourceButton.style.display = "none";
  sourceButton.setAttribute("aria-hidden", "true");
  sourceButton.tabIndex = -1;
  parent.insertBefore(managedButton, sourceButton);
}

function installManagedButtons(root: ParentNode, host: Host) {
  const sourceButtons = Array.from(
    root.querySelectorAll<HTMLElement>(CONNECT_BUTTON_SELECTOR)
  ).filter((button) => !button.matches(CONNECT_PROXY_SELECTOR));

  for (const sourceButton of sourceButtons) {
    installManagedButton(sourceButton, host);
  }
}

function restoreManagedButtons() {
  const sourceButtons = Array.from(
    document.querySelectorAll<HTMLElement>(
      `${CONNECT_BUTTON_SELECTOR}[data-spotify-plus-device-picker-managed="true"]`
    )
  );

  for (const sourceButton of sourceButtons) {
    const proxyButton = sourceButton.previousElementSibling;
    if (proxyButton instanceof HTMLElement && proxyButton.matches(CONNECT_PROXY_SELECTOR)) {
      if (popupButton === proxyButton) {
        popupButton = null;
      }
      if (managedTooltipButton === proxyButton) {
        hideManagedTooltip();
      }
      proxyButton.remove();
    }

    sourceButton.style.display = "";
    sourceButton.removeAttribute("aria-hidden");
    sourceButton.removeAttribute("data-spotify-plus-device-picker-managed");
    sourceButton.tabIndex = 0;
  }
}

function positionPopup() {
  if (!popupRoot || !popupButton?.isConnected) return;

  const rect = popupButton.getBoundingClientRect();
  const width = 336;
  const popupHeight = popupRoot.getBoundingClientRect().height || 320;
  const left = Math.min(
    window.innerWidth - width - 16,
    Math.max(16, rect.left + rect.width / 2 - width / 2)
  );
  const top = Math.max(16, rect.top - popupHeight - 14);

  popupRoot.style.left = `${left}px`;
  popupRoot.style.top = `${top}px`;
}

function closeDevicePicker() {
  window.clearInterval(openRefreshHandle);
  openRefreshHandle = 0;
  popupContents?.unmount();
  popupContents = null;
  popupRoot?.remove();
  popupRoot = null;
  if (popupButton?.isConnected) {
    setButtonOpenState(popupButton, false);
  }
  popupButton = null;
}

function syncDevicePickerMode(host: Host) {
  if (isEnabled()) {
    hideConnectSidebar();
    installManagedButtons(document, host);
    return;
  }

  closeDevicePicker();
  showConnectSidebar();
  restoreManagedButtons();
}

async function transferPlayback(deviceId: string) {
  const transferApi = getConnectTransferApi();
  if (!transferApi?.transferPlayback) {
    throw new Error("transferPlayback unavailable");
  }

  await transferApi.transferPlayback(deviceId, {});
}

function createPopupRoot() {
  const root = document.createElement("div");
  root.className = "SpotifyPlusDevicePickerPopover";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Connect to a device");
  root.innerHTML = `
    <div class="SpotifyPlusDevicePickerCard">
      <div class="SpotifyPlusDevicePickerContent">
        <div data-device-picker-contents></div>
        <div class="SpotifyPlusDevicePickerFooter">
          <a href="https://support.spotify.com/article/spotify-connect/" target="_blank" rel="noreferrer noopener">Don’t see your device?</a>
          <a href="https://www.spotify.com/connect?utm_campaign=connect&utm_medium=app&utm_source=desktop" target="_blank" rel="noreferrer noopener">What can I connect to?</a>
        </div>
      </div>
    </div>
    <div class="SpotifyPlusDevicePickerArrowPill" aria-hidden="true">
      <div class="SpotifyPlusDevicePickerArrow"></div>
    </div>
  `;
  return root;
}

async function renderPopupContents(root: HTMLDivElement) {
  const devicesApi = getConnectDevicesApi();
  if (!devicesApi || !popupContents) return;
  const [devicesRaw, activeDevice] = await Promise.all([
    devicesApi.getDevices?.() ?? Promise.resolve([]),
    devicesApi.getActiveDevice?.() ?? Promise.resolve(null),
  ]);
  if (popupRoot !== root || !popupContents) return;

  const devices = Array.isArray(devicesRaw) ? devicesRaw : [];
  const others = devices.filter(device => device?.id && device.id !== activeDevice?.id && device.name);
  const fallback = popupButton?.querySelector("svg");
  popupContents.render(<>
    <div className="SpotifyPlusDevicePickerCurrent">
      <div className="SpotifyPlusDevicePickerHeading">
        <PickerIcon device={activeDevice} fallback={fallback} />
        <div className="SpotifyPlusDevicePickerHeadingContent">
          <div className="SpotifyPlusDevicePickerHeadingTitle">Current device</div>
          <div className="SpotifyPlusDevicePickerHeadingSubtitle">{getDeviceLabel(activeDevice)}</div>
        </div>
      </div>
    </div>
    <div className="SpotifyPlusDevicePickerSection">
      <div className="SpotifyPlusDevicePickerSectionHeading">Select another device</div>
      <div className="SpotifyPlusDevicePickerList lyssna-device-scroll">
        {others.length ? others.map(device =>
          <button className="SpotifyPlusDevicePickerRow" type="button" key={device.id} onClick={async event => {
            const button = event.currentTarget;
            button.disabled = true;
            try {
              await transferPlayback(device.id);
              if (popupRoot === root) closeDevicePicker();
            } catch {
              button.disabled = false;
              Spicetify.showNotification?.("Lyssna Lyrics: failed to transfer playback", true);
            }
          }}>
            <PickerIcon device={device} fallback={fallback} />
            <span>{getDeviceLabel(device)}</span>
          </button>
        ) : <div className="SpotifyPlusDevicePickerEmpty">No other available devices right now.</div>}
      </div>
    </div>
  </>);
}

async function openDevicePicker(button: HTMLElement, host: Host) {
  if (isOpening) return;
  if (popupRoot && popupButton === button) {
    closeDevicePicker();
    return;
  }

  isOpening = true;
  closeDevicePicker();
  hideConnectSidebar();
  hideConnectTooltips();

  popupButton = button;
  setButtonOpenState(button, true);
  const root = createPopupRoot();
  popupRoot = root;
  document.body.appendChild(root);
  popupContents = host.mount(root.querySelector<HTMLElement>("[data-device-picker-contents]")!);
  positionPopup();

  try {
    await renderPopupContents(root);
    requestAnimationFrame(positionPopup);
  } catch {
    closeDevicePicker();
    Spicetify.showNotification?.("Lyssna Lyrics: failed to open device picker", true);
  } finally {
    isOpening = false;
  }

  if (popupRoot !== root) return;
  openRefreshHandle = window.setInterval(() => {
    if (!popupRoot) return;
    void renderPopupContents(popupRoot).then(positionPopup).catch(() => closeDevicePicker());
  }, 2500);
}

function onDocumentClick(event: MouseEvent, host: Host) {
  if (!isEnabled()) return;

  const target = event.target;
  if (!(target instanceof Node)) return;

  const button = target instanceof Element
    ? target.closest<HTMLElement>(CONNECT_PROXY_SELECTOR)
    : null;

  if (button) {
    event.preventDefault();
    event.stopPropagation();
    void openDevicePicker(button, host);
    return;
  }

  const connectBarText = target instanceof Element
    ? target.closest<HTMLElement>(CONNECT_BAR_TEXT_SELECTOR)
    : null;
  const managedButton = connectBarText
    ? document.querySelector<HTMLElement>(CONNECT_PROXY_SELECTOR)
    : null;

  if (managedButton) {
    event.preventDefault();
    event.stopPropagation();
    void openDevicePicker(managedButton, host);
    return;
  }

  if (popupRoot && !popupRoot.contains(target)) {
    closeDevicePicker();
  }
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && popupRoot) {
    closeDevicePicker();
  }
}

function onWindowChanged() {
  positionPopup();
  positionManagedTooltip();
}

export function startDevicePickerController(host: Host) {
  syncDevicePickerMode(host);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.target instanceof Element && mutation.target.closest(".lyssna-lyrics-view, #LyssnaLyricsPage, #SpicyLyricsPage")) continue;
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (isEnabled() && (isConnectSidebar(node) || node.querySelector(CONNECT_SIDEBAR_SELECTOR))) {
          hideConnectSidebar();
        }
        if (isEnabled()) {
          if (node instanceof HTMLElement && node.matches(CONNECT_BUTTON_SELECTOR) && !node.matches(CONNECT_PROXY_SELECTOR)) {
            installManagedButton(node, host);
          }

          if (node.querySelector(CONNECT_BUTTON_SELECTOR)) {
            installManagedButtons(node, host);
          }
        }
        if (popupRoot && (isConnectTooltipRoot(node) || node.querySelector("[data-tippy-root]"))) {
          hideConnectTooltips();
        }
      }
    }

    if (popupRoot && popupButton && !popupButton.isConnected) {
      closeDevicePicker();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  document.addEventListener("click", event => onDocumentClick(event, host), true);
  document.addEventListener("keydown", onDocumentKeydown, true);
  window.addEventListener("resize", onWindowChanged);
  window.addEventListener("scroll", onWindowChanged, true);
  window.addEventListener(SETTINGS_CHANGED_EVENT, (event) => {
    const key = (event as CustomEvent<{ key?: string }>).detail?.key;
    if (key && key !== "restoreOldDevicePicker") return;
    syncDevicePickerMode(host);
  });
}
