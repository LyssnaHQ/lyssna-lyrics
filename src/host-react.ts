import type * as React from "react";

export const hosts = globalThis as typeof globalThis & {
  Spicetify?: { React?: typeof React; ReactDOM?: unknown };
  SpotiKit?: { React?: typeof React; ReactDOM?: unknown };
};

export const hostReact = hosts.SpotiKit?.React ?? hosts.Spicetify?.React;
if (!hostReact) throw new Error("Spotify React is unavailable");

export const {
  createContext, createElement, forwardRef, Fragment, memo, useCallback, useContext,
  useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
} = hostReact;
export default hostReact;
