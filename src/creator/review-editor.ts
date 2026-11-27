import type { ReviewSubmission } from "./review-api";
import type { CreatorLine } from "./ttml-creator-model";

export type ReviewOpen = {
  submission: ReviewSubmission;
  uri: string;
  ttml: string;
  resumeDraft?: boolean;
};

export type ReviewDraft = {
  uri: string;
  lines: CreatorLine[];
  open: boolean;
  ready: boolean;
  submission?: { id: string; revision?: string; changed: boolean };
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
    closeDraft() {
      if (!draft?.open) return;
      draft = { ...draft, open: false };
      update();
    },
  };
}

export type ReviewEditor = ReturnType<typeof createReviewEditor>;
