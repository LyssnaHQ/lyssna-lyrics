function GravityIcon() {
  return <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
    <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
    <g className="gravity-orbit">
      <ellipse cx="12" cy="12" rx="10" ry="4.5" transform="rotate(-36 12 12)" />
      <circle cx="19.7" cy="6.4" r="2.1" fill="currentColor" stroke="none" />
    </g>
  </svg>;
}

function HighlighterIcon() {
  return <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <g className="marker-pen">
      <path d="m8 13 8.7-8.7a1.8 1.8 0 0 1 2.6 0l.4.4a1.8 1.8 0 0 1 0 2.6L11 16l-3-3Z" />
      <path d="m8 13-2 2 3 3 2-2m-5-1-2 3 2 1 3-1" />
    </g>
    <path className="marker-stroke" d="M4 21h15" pathLength={1} />
  </svg>;
}

export const quickEffects = [
  { id: "space_gravity", label: "Space Gravity", Icon: GravityIcon },
  { id: "lyrics_highlighter", label: "Highlighter", Icon: HighlighterIcon },
] as const;
