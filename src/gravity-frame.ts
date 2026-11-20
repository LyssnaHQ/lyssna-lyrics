type WordView = {
  size?: { width: number; height: number };
  transform?: string;
  effect?: KeyframeEffect;
  animation?: Animation;
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
      words.get(node)?.animation?.cancel();
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
      // A held animation updates the transform without mutating the style
      // attribute watched by Spotify's scrollbar observer.
      const keyframes = [{ transform }, { transform }];
      if (word.effect) word.effect.setKeyframes(keyframes);
      else {
        word.effect = new KeyframeEffect(node, keyframes, { duration: 1, fill: "both" });
        word.animation = new Animation(word.effect, node.ownerDocument.timeline);
        word.animation.currentTime = 0;
      }
    },
    dispose() {
      observer.disconnect();
      for (const word of words.values()) word.animation?.cancel();
      words.clear();
    },
  };
}
