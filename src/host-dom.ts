import type { ReactNode, ReactPortal } from "react";
import { hosts } from "./host-react";

export function createPortal(node: ReactNode, container: HTMLElement): ReactPortal {
  const dom = (hosts.SpotiKit?.ReactDOM ?? hosts.Spicetify?.ReactDOM) as {
    createPortal(node: ReactNode, container: HTMLElement): ReactPortal;
  };
  return dom.createPortal(node, container);
}
