type WordView = {
  size?: { width: number; height: number };
  transform?: string;
};

export function trackGravityStage(stage: HTMLElement) {
  const words = new Map<HTMLElement, WordView>();
  let resized = false;
  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      if (entry.target === stage) {
        resized = true;
        continue;
      }
      const word = words.get(entry.target as HTMLElement);
      const size = entry.borderBoxSize[0];
      if (word && size) word.size = { width: size.inlineSize, height: size.blockSize };
    }
  });
  observer.observe(stage, { box: "border-box" });

  return {
    add(node: HTMLElement) {
      words.set(node, {});
      observer.observe(node, { box: "border-box" });
    },
    remove(node: HTMLElement) {
      words.delete(node);
      observer.unobserve(node);
    },
    size(node: HTMLElement) { return words.get(node)?.size; },
    takeStageResize() {
      const changed = resized;
      resized = false;
      return changed;
    },
    move(node: HTMLElement, transform: string) {
      const word = words.get(node);
      if (!word || word.transform === transform) return;
      word.transform = transform;
      node.style.transform = transform;
    },
    dispose() {
      observer.disconnect();
      words.clear();
    },
  };
}
