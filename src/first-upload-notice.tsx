import { useId, useLayoutEffect, useRef, type CSSProperties } from "react";
import { BookOpen, Send, X } from "lucide-react";
import { accountChanged } from "./lyssna-account";

const terms = "https://lyssna.org/developers/terms#8-rights-in-the-data";

export function useFirstUploadNotice(style: CSSProperties, glass: boolean) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const resolve = useRef<((confirmed: boolean) => void) | undefined>(undefined);
  const titleId = useId();
  const noticeId = useId();

  function finish(confirmed: boolean) {
    const done = resolve.current;
    resolve.current = undefined;
    done?.(confirmed);
  }

  useLayoutEffect(() => {
    const cancelOnAccountChange = () => dialog.current?.close("cancel");
    window.addEventListener(accountChanged, cancelOnAccountChange);
    return () => {
      window.removeEventListener(accountChanged, cancelOnAccountChange);
      finish(false);
    };
  }, []);

  function confirmFirstUpload() {
    const element = dialog.current;
    if (!element?.isConnected || element.open || resolve.current) return Promise.resolve(false);
    element.returnValue = "";
    element.showModal();
    cancel.current?.focus();
    return new Promise<boolean>((done) => { resolve.current = done; });
  }

  const firstUploadNotice = <dialog ref={dialog} style={style}
    className={`dialog load-ttml lyssna-first-upload${glass ? " liquid-glass" : ""}`}
    aria-labelledby={titleId} aria-describedby={noticeId}
    onClose={(event) => finish(event.currentTarget.returnValue === "upload")}
    onKeyDown={(event) => event.stopPropagation()}>
    <header className="load-ttml-head">
      <h2 id={titleId}>Before you upload to Lyssna</h2>
      <button className="icon-button" type="button" aria-label="Close" onClick={() => dialog.current?.close("cancel")}>
        <X size={20} />
      </button>
    </header>
    <div className="load-ttml-body">
      <p id={noticeId} className="load-ttml-reviewer first-upload-copy">
        By uploading, you agree that you can’t remove your lyrics from Lyssna once they’re published.
        The community can build on your sync, and removing it would disrupt their edits.
      </p>
      <form method="dialog" className="load-ttml-actions first-upload-actions">
        <a href={terms} target="_blank" rel="noopener noreferrer"><BookOpen size={14} /> Read the Lyssna terms</a>
        <button ref={cancel} type="submit" value="cancel">Cancel</button>
        <button type="submit" value="upload"><Send size={14} /> Agree and upload</button>
      </form>
    </div>
  </dialog>;
  return { confirmFirstUpload, firstUploadNotice };
}
