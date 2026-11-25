import type { CSSProperties } from "react";
import { createPortal } from "./host-dom";
import type { SubmissionFeedback } from "./lyssna-submission";

const confetti = [
  [-94, -29, -180], [-72, -64, 200], [-49, -45, -115], [-31, -78, 140],
  [-9, -56, -205], [15, -82, 175], [35, -49, -135], [50, -72, 240],
  [70, -44, -195], [94, -23, 180],
];
const colours = ["#1ed760", "#ffce72", "#c1a2ff", "#71d9ff", "#ff92b1"];

export function SubmissionNotice({ feedback, container, reduceMotion, style }: {
  feedback: SubmissionFeedback;
  container: HTMLElement;
  reduceMotion: boolean;
  style: CSSProperties;
}) {
  return createPortal(<div className="lyssna-submission-notice" data-error={feedback.error || undefined}
    data-shake={feedback.error && !reduceMotion || undefined} style={style}>
    <div className="lyssna-submission-message" role={feedback.error ? "alert" : "status"}>{feedback.message}</div>
    {feedback.approved && !reduceMotion && <div className="lyssna-submission-confetti" aria-hidden="true">
      {confetti.map(([x, y, spin], index) => <span key={index} style={{
        "--confetti-x": `${x}px`, "--confetti-y": `${y}px`, "--confetti-spin": `${spin}deg`,
        backgroundColor: colours[index % colours.length],
      } as CSSProperties} />)}
    </div>}
  </div>, container);
}
