import type * as React from "react";

export const hosts = globalThis as typeof globalThis & {
  Spicetify?: { React?: typeof React; ReactDOM?: unknown };
  SpotiKit?: { React?: typeof React; ReactDOM?: unknown };
};

export const hostReact = hosts.SpotiKit?.React ?? hosts.Spicetify?.React;
if (!hostReact) throw new Error("Spotify React is unavailable");

export const { createElement, Fragment, memo, useEffect, useMemo, useRef, useState } = hostReact;
