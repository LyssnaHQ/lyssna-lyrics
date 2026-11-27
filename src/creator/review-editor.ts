import { useSyncExternalStore } from "react";
import type { ReviewSubmission } from "./review-api";
import type { ReviewQuote } from "./review-quote-menu";
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

type ReviewQuoteContext = {
  uri: string;
  id: string;
  revision?: string;
  comment(quote: ReviewQuote): void;
};

/** The editor and the Spotify sidebar have independent lifetimes. */
export function createReviewEditor() {
  let request: ReviewOpen | undefined;
  let draft: ReviewDraft | undefined;
  let quoteContext: ReviewQuoteContext | undefined;
  const listeners = new Set<() => void>();
  const update = () => listeners.forEach(listener => listener());
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    request: () => request,
    draft: () => draft,
    quoteContext: () => quoteContext,
    registerQuoteContext(context: ReviewQuoteContext) {
      quoteContext = context;
      update();
      return () => {
        if (quoteContext !== context) return;
        quoteContext = undefined;
        update();
      };
    },
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

const noQuoteContext = () => undefined;
const noReviewSubscription = () => () => {};

export function useReviewComments(editor: ReviewEditor | undefined, uri: string | undefined,
  submission?: { id: string; revision?: string }) {
  const context = useSyncExternalStore(editor?.subscribe ?? noReviewSubscription, editor?.quoteContext ?? noQuoteContext);
  if (!context || context.uri !== uri) return;
  if (submission && (context.id !== submission.id || context.revision !== submission.revision)) return;
  return context.comment;
}
