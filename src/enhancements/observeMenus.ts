export function observeMenus(update: () => void): MutationObserver {
  let queued = false;
  const observer = new MutationObserver(records => {
    const relevant = records.some(record => {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      if (target?.closest(".lyssna-lyrics-view, #LyssnaLyricsPage, #SpicyLyricsPage")) return false;
      if (target?.closest("#context-menu, [role='menu']")) return true;
      return [...record.addedNodes, ...record.removedNodes].some(node => node instanceof Element &&
        (node.matches("#context-menu, [role='menu']") || !!node.querySelector("#context-menu, [role='menu']")));
    });
    if (!relevant || queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; update(); });
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return observer;
}
