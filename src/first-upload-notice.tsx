import { useId, useLayoutEffect, useRef, type CSSProperties } from "react";
import { accountChanged } from "./lyssna-account";

const terms = "https://lyssna.org/developers/terms#8-rights-in-the-data";

export function useFirstUploadNotice(style: CSSProperties) {
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

  const firstUploadNotice = <dialog ref={dialog} style={style} className="lyssna-first-upload"
    aria-labelledby={titleId} aria-describedby={noticeId}
    onClose={(event) => finish(event.currentTarget.returnValue === "upload")}
    onKeyDown={(event) => event.stopPropagation()}>
    <h2 id={titleId}>Before you upload to Lyssna</h2>
    <p id={noticeId}>By uploading, you agree that you can’t remove your lyrics from Lyssna once they’re published.
      The community can build on your sync, and removing it would disrupt their edits.</p>
    <a href={terms} target="_blank" rel="noopener noreferrer">Read the Lyssna terms</a>
    <form method="dialog">
      <button ref={cancel} type="submit" value="cancel">Cancel</button>
      <button type="submit" value="upload">Agree and upload</button>
    </form>
  </dialog>;
  return { confirmFirstUpload, firstUploadNotice };
}
