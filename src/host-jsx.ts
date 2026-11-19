import { createElement } from "./host-react";

export { Fragment } from "./host-react";

export function jsx(type: Parameters<typeof createElement>[0], props: object, key?: string) {
  return createElement(type, key === undefined ? props : { ...props, key });
}

export const jsxs = jsx;
