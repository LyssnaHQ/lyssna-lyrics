import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useCreatorEnvironment } from "./environment";
import { hasLiveSpectrum, liveSpectrumCleared, liveSpectrumSaved, mergeLiveTile, readLiveTiles, type LiveTile } from "./spectrum-storage";

type BufferedTile = { tile: LiveTile; revision: number };

export function useLiveSpectrum(uri: string, canCapture: boolean) {
  const { capture, view } = useCreatorEnvironment();
  const state = useSyncExternalStore(capture.subscribe, capture.state);
  const active = state.scope === uri || state.scope === "auto";
  const [hasSaved, setHasSaved] = useState(false);
  const [, redraw] = useState(0);
  const tiles = useRef(new Map<number, BufferedTile>());
  const visible = useRef({ first: 0, last: -1 });
  const revision = useRef(0);

  const mergeTiles = useCallback((loaded: LiveTile[]) => {
    for (const tile of loaded) {
      const entry = tiles.current.get(tile.index);
      if (entry) {
        entry.tile = mergeLiveTile(entry.tile, tile);
        entry.revision++;
      } else tiles.current.set(tile.index, { tile, revision: 0 });
    }

    const { first, last } = visible.current;
    for (const index of tiles.current.keys()) {
      if (tiles.current.size <= 32) break;
      if (index < first || index > last) tiles.current.delete(index);
    }
    if (loaded.length) redraw((value) => value + 1);
  }, []);

  useEffect(() => {
    let live = true;
    const generation = revision.current;
    const cleared = (event: Event) => {
      const removed = (event as CustomEvent<string | undefined>).detail;
      if (removed && removed !== uri) return;
      revision.current++;
      tiles.current.clear();
      setHasSaved(false);
      redraw((value) => value + 1);
    };
    const saved = (event: Event) => {
      const changed = (event as CustomEvent<LiveTile[]>).detail.filter((tile) => tile.uri === uri);
      if (!changed.length) return;
      setHasSaved(true);
      // The writer broadcasts the same tiles to every open editor.
      mergeTiles(changed.map((tile) => ({ ...tile, levels: tile.levels.slice(), filled: tile.filled.slice() })));
    };
    view.addEventListener(liveSpectrumCleared, cleared);
    view.addEventListener(liveSpectrumSaved, saved);
    void hasLiveSpectrum(uri).then((saved) => {
      if (live && saved && generation === revision.current) setHasSaved(true);
    }).catch(() => {});
    return () => {
      live = false;
      view.removeEventListener(liveSpectrumCleared, cleared);
      view.removeEventListener(liveSpectrumSaved, saved);
    };
  }, [uri, view, mergeTiles]);

  const load = useCallback((first: number, last: number) => {
    visible.current = { first, last };
    if (last < first) return () => {};
    let current = true;
    const generation = revision.current;
    void readLiveTiles(uri, first, last).then((loaded) => {
      if (current && generation === revision.current) mergeTiles(loaded);
    }).catch(() => {});
    return () => { current = false; };
  }, [uri, mergeTiles]);

  return {
    status: active ? state.status : "idle",
    message: active ? state.message : "",
    sharePrompt: capture.sharePrompt, hasSaved, tiles: tiles.current, load,
    start: () => { if (canCapture) return capture.start(uri); },
    stop: capture.stop,
  };
}
