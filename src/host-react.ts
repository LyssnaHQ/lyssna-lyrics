import type * as React from "react";

export const hosts = globalThis as typeof globalThis & {
  Spicetify?: { React?: typeof React; ReactDOM?: unknown };
  SpotiKit?: { React?: typeof React; ReactDOM?: unknown };
};

export const hostReact = hosts.SpotiKit?.React ?? hosts.Spicetify?.React;
if (!hostReact) throw new Error("Spotify React is unavailable");

export const {
  cloneElement, createContext, createElement, forwardRef, Fragment, isValidElement, memo, useCallback, useContext,
  useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore,
} = hostReact;
export default hostReact;
