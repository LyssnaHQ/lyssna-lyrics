import type { ReviewSubmission } from "./review-api";
import type { Lyrics } from "./types";

export type ReviewOpen = {
  submission: ReviewSubmission;
  uri: string;
  ttml: string;
};

export type ReviewDraft = {
  id: string;
  revision?: string;
  changed: boolean;
  preview(): Lyrics;
  save(): string;
};

/** The editor and the Spotify sidebar have independent lifetimes. */
export function createReviewEditor() {
  let request: ReviewOpen | undefined;
  let draft: ReviewDraft | undefined;
  const listeners = new Set<() => void>();
  const update = () => listeners.forEach(listener => listener());
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    request: () => request,
    draft: () => draft,
    open(next: ReviewOpen) {
      request = next;
      update();
    },
    cancel(expected = request) {
      if (!request || request !== expected) return;
      request = undefined;
      update();
    },
    publish(next?: ReviewDraft) {
      if (draft === next) return;
      draft = next;
      update();
    },
  };
}

export type ReviewEditor = ReturnType<typeof createReviewEditor>;
