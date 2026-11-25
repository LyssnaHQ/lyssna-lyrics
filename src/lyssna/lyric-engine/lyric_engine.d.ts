/* tslint:disable */
/* eslint-disable */

export class Countdown {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Targets and result as `opacity, scale, glow, lift` fours.
     */
    frame(targets: Float64Array, time: number, now: number, snap: boolean): Float64Array;
    constructor();
}

/**
 * A word group split into floating pieces.
 */
export class GravityPieces {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * `timing` holds `start, end, estimated` per word.
     */
    constructor(texts: string[], timing: Float64Array);
    texts(): string[];
    /**
     * Per piece: `start, end, first, count, split, word start, word end,
     * letter offset, letter count` (letters negative when not held).
     */
    values(): Float64Array;
}

/**
 * A song's lines, parsed once and kept in the engine for the view's
 * per-frame questions.
 */
export class LyricLines {
    free(): void;
    [Symbol.dispose](): void;
    activeLines(time: number): Uint32Array;
    allSung(time: number): boolean;
    endsOnRight(mirrored: boolean): boolean;
    highlighterTime(index: number, highlighter: boolean, playing: boolean, time: number): number;
    /**
     * Lines as `start, end, opposite, background, word count, word ends…`.
     */
    constructor(flat: Float64Array);
    /**
     * `cued` is the line clicked while paused, or -1.
     */
    primaryLine(time: number, cued: number): number;
    vocalEnd(index: number): number;
    vocalGap(time: number): Float64Array;
    /**
     * Gaps as `start, end, after, opposite` fours.
     */
    vocalGaps(): Float64Array;
}

/**
 * The lyrics scroll position: a spring between lines and a glide after
 * seeks.
 */
export class Scroller {
    free(): void;
    [Symbol.dispose](): void;
    constructor();
    place(): void;
    shiftGlide(by: number): void;
    startGlide(from: number, now: number): void;
    start(now: number): void;
    stopGlide(): void;
    tick(now: number): number;
    readonly gliding: boolean;
    position: number;
    readonly running: boolean;
    target: number;
    velocity: number;
}

export class Spline {
    free(): void;
    [Symbol.dispose](): void;
    at(x: number): number;
    /**
     * Points as `x, y` pairs.
     */
    constructor(points: Float64Array);
}

export class Spring {
    free(): void;
    [Symbol.dispose](): void;
    constructor(position: number, frequency: number, damping: number);
    step(seconds: number): number;
    readonly asleep: boolean;
    damping: number;
    goal: number;
    position: number;
    velocity: number;
}

/**
 * One rendered syllable of a live line, with its held word's letters. The
 * animator steps it every frame and writes the values it returns.
 */
export class Syllable {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * `letters` is how many of the held word's letters this piece shows,
     * starting at `letter_offset` of `letter_count`.
     */
    constructor(start: number, end: number, emphasis: boolean, letters: number, letter_offset: number, letter_count: number, calm: number, simple: boolean);
    /**
     * Steps the springs to song `time` and reports whether any still move.
     */
    step(time: number, seconds: number, reduce_motion: boolean): boolean;
    /**
     * The values the last step produced, piece by piece, word first.
     */
    values(): Float64Array;
}

export function bodyIntersects(body: Float64Array, rect: Float64Array): boolean;

export function constrainBody(body: Float64Array, field: Float64Array): Float64Array;

/**
 * Three dots as `opacity, scale, glow, lift` fours.
 */
export function countdownDots(gap_start: number, gap_end: number, time: number, reduce_motion: boolean): Float64Array;

export function countdownTime(gap_start: number, gap_end: number, position: number): number;

export function countdownVisible(gap_start: number, gap_end: number, time: number): boolean;

export function createBody(seed: number, speed: number, line_start: number, order: number): Float64Array;

export function cueHolds(playing: boolean, position: number, clicked_at: number, line_start: number): boolean;

export function glideScroll(from: number, to: number, elapsed: number): number;

export function gravityHash(text: string): number;

export function gravityRandom(seed: number): number;

export function heldTarget(target: number, line_top: number, card: boolean, focus: number, end: number): number;

export function isEmphasis(start: number, end: number, text: string, estimated: boolean): boolean;

export function leadTop(card: boolean, compact: boolean, stacked: boolean, client_height: number, opening: number, focus: number, first_line_height: number): number;

export function letterGoals(start: number, end: number, time: number, count: number): Float64Array;

export function lineBlur(distance: number): number;

/**
 * Sizes as `width, height` pairs; returns each word's centre pair, then the
 * line height.
 */
export function lineLayout(sizes: Float64Array, width: number, opposite: boolean, gap: number): Float64Array;

/**
 * Fill position of a line without word timing, or NaN when it should rest.
 */
export function lineWipe(start: number, end: number, time: number, simple: boolean): number;

export function measureBody(body: Float64Array, width: number, height: number): Float64Array;

/**
 * 0 scale, 1 letter scale, 2 lift, 3 letter lift, 4 glow.
 */
export function motionCurve(curve: number, x: number): number;

/**
 * Scalars and spring settings, in the order `lyric-motion.ts` reads them.
 */
export function motionSettings(): Float64Array;

export function positionJumped(last: number, now: number): boolean;

export function resumeFollowing(now: number, browsed_at: number, line_top: number, line_bottom: number, view_top: number, view_bottom: number): boolean;

export function scrollFocus(card: boolean, client_height: number): number;

export function scrollTarget(line_top: number, line_height: number, centred: boolean, focus: number, client_height: number, scroll_height: number): number;

export function simpleGoal(start: number, end: number, time: number): Float64Array;

export function spawnBody(body: Float64Array, occupied: Float64Array, field: Float64Array, reduced: boolean, across: number, down: number, phase: number): Float64Array;

export function spawnOverlap(body: Float64Array, other: Float64Array): number;

export function speedMultiplier(word_starts: Float64Array): number;

/**
 * `sizes` holds each line's body count; bodies run line after line.
 */
export function staticLayout(bodies: Float64Array, sizes: Uint32Array, field: Float64Array): Float64Array;

/**
 * Steps shown bodies and fading ones together; returns both, shown first.
 */
export function stepBodies(bodies: Float64Array, dt: number, field: Float64Array, window_vx: number, window_vy: number, exiting: Float64Array): Float64Array;

export function stepScroll(position: number, velocity: number, target: number, seconds: number): Float64Array;

/**
 * 0 unsung, 1 active, 2 sung.
 */
export function sungState(start: number, end: number, time: number): number;

/**
 * Window motion as `x, y, vx, vy`, with NaN x and y before the first sample.
 */
export function trackWindow(motion: Float64Array, x: number, y: number, dt: number): Float64Array;

export function tuneMotion(legacy: boolean, idle_scale: number, word_peak_scale: number, letter_peak_scale: number, vertical_strength: number, glow_strength: number, scale_frequency: number, scale_damping: number, vertical_frequency: number, vertical_damping: number, glow_frequency: number, glow_damping: number, blur_strength: number): void;

export function visibleWordCount(field: Float64Array): number;

export function vocalEnd(end: number, word_ends: Float64Array): number;

export function wordGoal(start: number, end: number, time: number): Float64Array;

export function wordGroupSizes(texts: string[]): Uint32Array;

export function wordWindow(anchor: number, total: number, count: number): Float64Array;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_countdown_free: (a: number, b: number) => void;
    readonly __wbg_gravitypieces_free: (a: number, b: number) => void;
    readonly __wbg_lyriclines_free: (a: number, b: number) => void;
    readonly __wbg_scroller_free: (a: number, b: number) => void;
    readonly __wbg_spline_free: (a: number, b: number) => void;
    readonly __wbg_spring_free: (a: number, b: number) => void;
    readonly __wbg_syllable_free: (a: number, b: number) => void;
    readonly bodyIntersects: (a: number, b: number, c: number, d: number) => number;
    readonly constrainBody: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly countdownDots: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly countdownTime: (a: number, b: number, c: number) => number;
    readonly countdownVisible: (a: number, b: number, c: number) => number;
    readonly countdown_frame: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly countdown_new: () => number;
    readonly createBody: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly cueHolds: (a: number, b: number, c: number, d: number) => number;
    readonly glideScroll: (a: number, b: number, c: number) => number;
    readonly gravityHash: (a: number, b: number) => number;
    readonly gravityRandom: (a: number) => number;
    readonly gravitypieces_new: (a: number, b: number, c: number, d: number) => number;
    readonly gravitypieces_texts: (a: number, b: number) => void;
    readonly gravitypieces_values: (a: number, b: number) => void;
    readonly heldTarget: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly isEmphasis: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly leadTop: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly letterGoals: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly lineBlur: (a: number) => number;
    readonly lineLayout: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly lineWipe: (a: number, b: number, c: number, d: number) => number;
    readonly lyriclines_activeLines: (a: number, b: number, c: number) => void;
    readonly lyriclines_allSung: (a: number, b: number) => number;
    readonly lyriclines_endsOnRight: (a: number, b: number) => number;
    readonly lyriclines_highlighterTime: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly lyriclines_new: (a: number, b: number) => number;
    readonly lyriclines_primaryLine: (a: number, b: number, c: number) => number;
    readonly lyriclines_vocalEnd: (a: number, b: number) => number;
    readonly lyriclines_vocalGap: (a: number, b: number, c: number) => void;
    readonly lyriclines_vocalGaps: (a: number, b: number) => void;
    readonly measureBody: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly motionCurve: (a: number, b: number) => number;
    readonly motionSettings: (a: number) => void;
    readonly positionJumped: (a: number, b: number) => number;
    readonly resumeFollowing: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly scrollFocus: (a: number, b: number) => number;
    readonly scrollTarget: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly scroller_gliding: (a: number) => number;
    readonly scroller_new: () => number;
    readonly scroller_place: (a: number) => void;
    readonly scroller_position: (a: number) => number;
    readonly scroller_running: (a: number) => number;
    readonly scroller_set_position: (a: number, b: number) => void;
    readonly scroller_set_target: (a: number, b: number) => void;
    readonly scroller_set_velocity: (a: number, b: number) => void;
    readonly scroller_shiftGlide: (a: number, b: number) => void;
    readonly scroller_start: (a: number, b: number) => void;
    readonly scroller_startGlide: (a: number, b: number, c: number) => void;
    readonly scroller_stopGlide: (a: number) => void;
    readonly scroller_target: (a: number) => number;
    readonly scroller_tick: (a: number, b: number) => number;
    readonly scroller_velocity: (a: number) => number;
    readonly simpleGoal: (a: number, b: number, c: number, d: number) => void;
    readonly spawnBody: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => void;
    readonly spawnOverlap: (a: number, b: number, c: number, d: number) => number;
    readonly speedMultiplier: (a: number, b: number) => number;
    readonly spline_at: (a: number, b: number) => number;
    readonly spline_new: (a: number, b: number) => number;
    readonly spring_asleep: (a: number) => number;
    readonly spring_damping: (a: number) => number;
    readonly spring_goal: (a: number) => number;
    readonly spring_new: (a: number, b: number, c: number) => number;
    readonly spring_position: (a: number) => number;
    readonly spring_set_damping: (a: number, b: number) => void;
    readonly spring_set_goal: (a: number, b: number) => void;
    readonly spring_set_position: (a: number, b: number) => void;
    readonly spring_set_velocity: (a: number, b: number) => void;
    readonly spring_step: (a: number, b: number) => number;
    readonly spring_velocity: (a: number) => number;
    readonly staticLayout: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly stepBodies: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => void;
    readonly stepScroll: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly sungState: (a: number, b: number, c: number) => number;
    readonly syllable_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => number;
    readonly syllable_step: (a: number, b: number, c: number, d: number) => number;
    readonly syllable_values: (a: number, b: number) => void;
    readonly trackWindow: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly tuneMotion: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number) => void;
    readonly visibleWordCount: (a: number, b: number) => number;
    readonly vocalEnd: (a: number, b: number, c: number) => number;
    readonly wordGoal: (a: number, b: number, c: number, d: number) => void;
    readonly wordGroupSizes: (a: number, b: number, c: number) => void;
    readonly wordWindow: (a: number, b: number, c: number, d: number) => void;
    readonly __wbindgen_export: (a: number, b: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export3: (a: number, b: number, c: number) => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
