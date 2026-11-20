import React, { useLayoutEffect, useState, type ComponentType, type Context, type ReactNode } from "react";
import { spicetify, spotikit } from "./host";

type ModuleLoader = ((id: string) => Record<string, unknown>) & { m?: Record<string, Function> };
type RuntimeChunk = [symbol[], Record<string, never>, (loader: ModuleLoader) => void];
type SpotifyRuntime = Window & {
  rspackChunk?: RuntimeChunk[];
  rspackChunkclient_web?: RuntimeChunk[];
  webpackChunkclient_web?: RuntimeChunk[];
};
type NativeDJ = { Animation: ComponentType; RegistryContext: Context<unknown>; registry: object };

let nativeDJ: NativeDJ | undefined;

function resolveNativeDJ(): NativeDJ | undefined {
  if (nativeDJ) return nativeDJ;
  const registry = (spotikit()?.Platform.Registry ?? spicetify()?.Platform?.Registry) as { resolve?: unknown } | undefined;
  if (typeof registry?.resolve !== "function") return;
  try {
    const runtime = window as SpotifyRuntime;
    const chunks = runtime.rspackChunk ?? runtime.rspackChunkclient_web ?? runtime.webpackChunkclient_web;
    if (!chunks || chunks.push === Array.prototype.push) return;

    let load: ModuleLoader | undefined;
    chunks.push([[Symbol("Lyssna DJ")], {}, (loader) => { load = loader; }]);
    if (!load?.m) return;

    // Resolve the installed client's own animation and the provider it uses.
    // Spotify's numeric module IDs change with client builds.
    let animationId: string | undefined;
    let registryAccessor: string | undefined;
    for (const [id, factory] of Object.entries(load.m)) {
      const source = Function.prototype.toString.call(factory);
      if (source.includes("narration.jellyfish.bottom.color") &&
        source.includes("Path2D") && source.includes("narration.jump.ssml")) animationId ??= id;
      if (source.includes("'RegistryContext' without 'RegistryProvider'")) registryAccessor ??= source;
      if (animationId && registryAccessor) break;
    }
    if (!animationId || !registryAccessor) return;
    const contextAccess = /\buseContext\)?\(\s*([\w$]+)\.([\w$]+)\s*\)/.exec(registryAccessor);
    if (!contextAccess) return;
    const [, alias, exportName] = contextAccess;
    const binding = new RegExp(`[,;\\s]${alias.replaceAll("$", "\\$")}\\s*=\\s*[\\w$]+\\(\\s*(\\d+)\\s*\\)`).exec(registryAccessor);
    if (!binding) return;

    const RegistryContext = load(binding[1])[exportName] as Context<unknown> | undefined;
    const Animation = Object.values(load(animationId)).find((entry): entry is ComponentType =>
      typeof entry === "function" && Function.prototype.toString.call(entry).includes("narration.jellyfish.top.color"));
    if (!RegistryContext?.Provider || !Animation) return;
    nativeDJ = { Animation, RegistryContext, registry };
    return nativeDJ;
  } catch (error) {
    console.warn("[Lyssna Lyrics] Could not load Spotify's DJ animation", error);
  }
}

class DJAnimationBoundary extends React.Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export function SpotifyDJAnimation({ fallback }: { fallback: ReactNode }) {
  const [animation, setAnimation] = useState<NativeDJ>();
  useLayoutEffect(() => { setAnimation(resolveNativeDJ()); }, []);
  if (!animation) return fallback;
  const { Animation, RegistryContext, registry } = animation;
  return <DJAnimationBoundary fallback={fallback}>
    <RegistryContext.Provider value={registry}><Animation /></RegistryContext.Provider>
  </DJAnimationBoundary>;
}
