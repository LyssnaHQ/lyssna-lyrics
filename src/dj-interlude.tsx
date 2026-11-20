// Lyssna's DJ artwork, shared with the desktop app.
const DJ_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' width='512' height='512' viewBox='0 0 100 100'>" +
  "<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>" +
  "<stop offset='0' stop-color='#1d74e6'/><stop offset='1' stop-color='#0a3a8c'/>" +
  "</linearGradient></defs>" +
  "<rect width='100' height='100' fill='url(#g)'/>" +
  "<circle cx='54' cy='48' r='26' fill='none' stroke='#38c8ff' stroke-opacity='.45' stroke-width='9'/>" +
  "<circle cx='49' cy='51' r='26' fill='none' stroke='#1ed760' stroke-width='8'/>" +
  "</svg>";

export const DJ_COVER = `data:image/svg+xml,${encodeURIComponent(DJ_SVG)}`;

export function DJInterlude({ playing }: { playing: boolean }) {
  return <div className="lyssna-dj-interlude" role="status">
    <img src={DJ_COVER} alt="" draggable={false} />
    <div>
      <h2>{playing ? "DJ is speaking…" : "DJ paused"}</h2>
      <p>Lyrics return when the next song starts.</p>
    </div>
  </div>;
}
