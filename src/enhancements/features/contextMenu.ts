import { Spicetify, kit, type Callback, type Predicate as MenuPredicate, type KitMenuOptions } from "../compat";

type MenuArguments = Parameters<Callback>;
type MenuEntry = { register(): void; kitOptions?: KitMenuOptions };
type MenuContext = { props: unknown; trigger?: string; target?: HTMLElement };
type ContextMenuV2 = {
  parseProps(props: unknown): MenuArguments | undefined;
  Item: new (options: {
    children: string;
    leadingIcon?: string;
    disabled?: boolean;
    shouldAdd: (props: unknown, trigger?: string, target?: HTMLElement) => boolean;
    onClick: (context: MenuContext) => void;
  }) => MenuEntry;
  ItemSubMenu: new (options: {
    text: string;
    items: MenuEntry[];
    disabled?: boolean;
    leadingIcon?: string;
    shouldAdd: (props: unknown, trigger?: string, target?: HTMLElement) => boolean;
  }) => MenuEntry;
};

const NOW_PLAYING_SELECTOR =
  "[data-testid='now-playing-widget'], [data-testid='now-playing-widget-v2'], .main-nowPlayingWidget-nowPlaying";
let nowPlayingContext: MenuArguments | undefined;

export function resetMenuContext() { nowPlayingContext = undefined; }

function kitMenu(kitOptions: KitMenuOptions): MenuEntry {
  return { kitOptions, register: () => kit?.ContextMenu?.add(kitOptions) };
}

function getContextMenuV2() {
  return (Spicetify as typeof Spicetify & { ContextMenuV2?: ContextMenuV2 }).ContextMenuV2;
}

function getMenuArguments(props: unknown, trigger?: string, target?: HTMLElement) {
  const parsed = getContextMenuV2()?.parseProps(props);
  if (parsed) return parsed;

  // Spotify's new Now Playing menu wrapper exposes canToggleCanvas, but no item URI.
  // The same wrapper serves the cover art and song title.
  if (
    trigger !== "right-click" ||
    !(target instanceof HTMLElement) ||
    !target.closest(NOW_PLAYING_SELECTOR)
  ) {
    return undefined;
  }

  if (!nowPlayingContext) {
    const state = Spicetify.Player?.data;
    if (!state?.item?.uri) return undefined;
    // Keep actions bound to the item selected when the menu opened, even after a song change.
    nowPlayingContext = [
      [state.item.uri],
      state.item.uid ? [state.item.uid] : undefined,
      state.context?.uri,
    ];
  }

  return nowPlayingContext;
}

function withMenuArguments(shouldAdd: MenuPredicate) {
  return (props: unknown, trigger?: string, target?: HTMLElement) => {
    const args = getMenuArguments(props, trigger, target);
    return Boolean(args && shouldAdd(...args));
  };
}

export function createContextMenuItem(
  name: string,
  onClick: Callback,
  shouldAdd: MenuPredicate,
  icon?: string,
  disabled = false
): MenuEntry {
  if (kit?.ContextMenu) return kitMenu({
    label: name, icon: icon?.startsWith("<") ? icon : undefined, disabled,
    when: ({ uris, uids, contextUri }) => shouldAdd(uris, uids, contextUri ?? undefined),
    onSelect: ({ uris, uids, contextUri }) => onClick(uris, uids, contextUri ?? undefined),
  });
  const api = getContextMenuV2();
  if (!api) {
    if (!Spicetify.ContextMenu) throw new Error("Spotify context menu is unavailable");
    return new Spicetify.ContextMenu.Item(name, onClick, shouldAdd, icon, undefined, disabled);
  }

  return new api.Item({
    children: name,
    leadingIcon: icon,
    disabled,
    shouldAdd: withMenuArguments(shouldAdd),
    onClick: ({ props, trigger, target }) => {
      const args = getMenuArguments(props, trigger, target);
      if (args) onClick(...args);
    },
  });
}

export function createContextMenuSubMenu(
  name: string,
  items: MenuEntry[],
  shouldAdd: MenuPredicate,
  icon?: string,
): MenuEntry {
  if (kit?.ContextMenu) return kitMenu({
    label: name, icon: icon?.startsWith("<") ? icon : undefined,
    items: items.flatMap((item) => item.kitOptions ? [item.kitOptions] : []),
    when: ({ uris, uids, contextUri }) => shouldAdd(uris, uids, contextUri ?? undefined),
  });
  const api = getContextMenuV2();
  if (!api) {
    if (!Spicetify.ContextMenu) throw new Error("Spotify context menu is unavailable");
    return new Spicetify.ContextMenu.SubMenu(
      name,
      items,
      shouldAdd,
      false,
      icon,
    );
  }

  return new api.ItemSubMenu({
    text: name,
    items,
    leadingIcon: icon,
    shouldAdd: withMenuArguments(shouldAdd),
  });
}
