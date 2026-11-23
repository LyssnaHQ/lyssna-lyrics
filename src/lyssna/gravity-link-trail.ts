import { Spring } from "./lyric-motion";

type Point = { x: number; y: number };
type Knot = { x: Spring; y: Spring };
const segments = 6;
const coupling = 0.78;

function bezier(start: Point, first: Point, second: Point, end: Point, t: number) {
  const u = 1 - t;
  return {
    x: u ** 3 * start.x + 3 * u ** 2 * t * first.x + 3 * u * t ** 2 * second.x + t ** 3 * end.x,
    y: u ** 3 * start.y + 3 * u ** 2 * t * first.y + 3 * u * t ** 2 * second.y + t ** 3 * end.y,
  };
}

const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
const pair = ({ x, y }: Point) => `${x.toFixed(1)} ${y.toFixed(1)}`;

/** Neighbouring spring knots pass motion along the trail while the ends
 *  stay fixed to the ink. The original curve is its resting shape. */
export class GravityLinkTrail {
  private knots?: Knot[];

  draw(start: Point, first: Point, second: Point, end: Point, out: number, into: number, dt: number) {
    const rest = Array.from({ length: segments + 1 }, (_, index) => bezier(start, first, second, end, index / segments));
    const knots = this.knots ??= rest.slice(1, -1).map(({ x, y }) => ({ x: new Spring(x, 4, 0.57), y: new Spring(y, 4, 0.57) }));
    const points = [start, ...knots.map(({ x, y }) => ({ x: x.position, y: y.position })), end];
    const slack = Math.max(4, Math.min(56, distance(start, end) * 0.21));

    // Read all neighbours from the same frame so the ripple can travel in either direction.
    for (let index = 1; index < segments; index++) {
      const knot = knots[index - 1], base = rest[index];
      const before = points[index - 1], after = points[index + 1];
      const previousBase = rest[index - 1], nextBase = rest[index + 1];
      knot.x.goal = base.x + coupling * (before.x + after.x - previousBase.x - nextBase.x) / 2;
      knot.y.goal = base.y + coupling * (before.y + after.y - previousBase.y - nextBase.y) / 2;
      const x = knot.x.step(dt) - base.x, y = knot.y.step(dt) - base.y;
      const offset = Math.hypot(x, y);
      if (offset > slack) {
        knot.x.position = base.x + x * slack / offset;
        knot.y.position = base.y + y * slack / offset;
        knot.x.velocity *= 0.5;
        knot.y.velocity *= 0.5;
      }
    }
    for (let index = 1; index < segments; index++) {
      points[index] = { x: knots[index - 1].x.position, y: knots[index - 1].y.position };
    }

    const handles = points.map((point, index) => {
      const before = points[index - 1], after = points[index + 1];
      if (!before || !after) {
        const angle = before ? into : out;
        const reach = distance(point, before ?? after) / 3;
        return { x: Math.cos(angle) * reach, y: Math.sin(angle) * reach };
      }
      const x = after.x - before.x, y = after.y - before.y;
      const reach = 0.48 * Math.min(distance(point, before), distance(point, after));
      const gain = Math.min(1 / 6, reach / (Math.hypot(x, y) || 1));
      return { x: x * gain, y: y * gain };
    });
    let path = `M${pair(start)}`;
    for (let index = 0; index < segments; index++) {
      const a = points[index], b = points[index + 1];
      const outgoing = handles[index], incoming = handles[index + 1];
      path += `C${pair({ x: a.x + outgoing.x, y: a.y + outgoing.y })} ${pair({ x: b.x - incoming.x, y: b.y - incoming.y })} ${pair(b)}`;
    }
    return path;
  }
}
