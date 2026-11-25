/* @ts-self-types="./lyric_engine.d.ts" */

export class Countdown {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        CountdownFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_countdown_free(ptr, 0);
    }
    /**
     * Targets and result as `opacity, scale, glow, lift` fours.
     * @param {Float64Array} targets
     * @param {number} time
     * @param {number} now
     * @param {boolean} snap
     * @returns {Float64Array}
     */
    frame(targets, time, now, snap) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArrayF64ToWasm0(targets, wasm.__wbindgen_export);
            const len0 = WASM_VECTOR_LEN;
            wasm.countdown_frame(retptr, this.__wbg_ptr, ptr0, len0, time, now, snap);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v2 = getArrayF64FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export3(r0, r1 * 8, 8);
            return v2;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    constructor() {
        const ret = wasm.countdown_new();
        this.__wbg_ptr = ret;
        CountdownFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
}
if (Symbol.dispose) Countdown.prototype[Symbol.dispose] = Countdown.prototype.free;

/**
 * A word group split into floating pieces.
 */
export class GravityPieces {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        GravityPiecesFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_gravitypieces_free(ptr, 0);
    }
    /**
     * `timing` holds `start, end, estimated` per word.
     * @param {string[]} texts
     * @param {Float64Array} timing
     */
    constructor(texts, timing) {
        const ptr0 = passArrayJsValueToWasm0(texts, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(timing, wasm.__wbindgen_export);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.gravitypieces_new(ptr0, len0, ptr1, len1);
        this.__wbg_ptr = ret;
        GravityPiecesFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {string[]}
     */
    texts() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.gravitypieces_texts(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayJsValueFromWasm0(r0, r1);
            wasm.__wbindgen_export3(r0, r1 * 4, 4);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Per piece: `start, end, first, count, split, word start, word end,
     * letter offset, letter count` (letters negative when not held).
     * @returns {Float64Array}
     */
    values() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.gravitypieces_values(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayF64FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export3(r0, r1 * 8, 8);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
}
if (Symbol.dispose) GravityPieces.prototype[Symbol.dispose] = GravityPieces.prototype.free;

/**
 * A song's lines, parsed once and kept in the engine for the view's
 * per-frame questions.
 */
export class LyricLines {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        LyricLinesFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_lyriclines_free(ptr, 0);
    }
    /**
     * @param {number} time
     * @returns {Uint32Array}
     */
    activeLines(time) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.lyriclines_activeLines(retptr, this.__wbg_ptr, time);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayU32FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export3(r0, r1 * 4, 4);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @param {number} time
     * @returns {boolean}
     */
    allSung(time) {
        const ret = wasm.lyriclines_allSung(this.__wbg_ptr, time);
        return ret !== 0;
    }
    /**
     * @param {boolean} mirrored
     * @returns {boolean}
     */
    endsOnRight(mirrored) {
        const ret = wasm.lyriclines_endsOnRight(this.__wbg_ptr, mirrored);
        return ret !== 0;
    }
    /**
     * @param {number} index
     * @param {boolean} highlighter
     * @param {boolean} playing
     * @param {number} time
     * @returns {number}
     */
    highlighterTime(index, highlighter, playing, time) {
        const ret = wasm.lyriclines_highlighterTime(this.__wbg_ptr, index, highlighter, playing, time);
        return ret;
    }
    /**
     * Lines as `start, end, opposite, background, word count, word ends…`.
     * @param {Float64Array} flat
     */
    constructor(flat) {
        const ptr0 = passArrayF64ToWasm0(flat, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.lyriclines_new(ptr0, len0);
        this.__wbg_ptr = ret;
        LyricLinesFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * `cued` is the line clicked while paused, or -1.
     * @param {number} time
     * @param {number} cued
     * @returns {number}
     */
    primaryLine(time, cued) {
        const ret = wasm.lyriclines_primaryLine(this.__wbg_ptr, time, cued);
        return ret >>> 0;
    }
    /**
     * @param {number} index
     * @returns {number}
     */
    vocalEnd(index) {
        const ret = wasm.lyriclines_vocalEnd(this.__wbg_ptr, index);
        return ret;
    }
    /**
     * @param {number} time
     * @returns {Float64Array}
     */
    vocalGap(time) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.lyriclines_vocalGap(retptr, this.__wbg_ptr, time);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayF64FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export3(r0, r1 * 8, 8);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Gaps as `start, end, after, opposite` fours.
     * @returns {Float64Array}
     */
    vocalGaps() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.lyriclines_vocalGaps(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayF64FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export3(r0, r1 * 8, 8);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
}
if (Symbol.dispose) LyricLines.prototype[Symbol.dispose] = LyricLines.prototype.free;

/**
 * The lyrics scroll position: a spring between lines and a glide after
 * seeks.
 */
export class Scroller {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ScrollerFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_scroller_free(ptr, 0);
    }
    /**
     * @returns {boolean}
     */
    get gliding() {
        const ret = wasm.scroller_gliding(this.__wbg_ptr);
        return ret !== 0;
    }
    constructor() {
        const ret = wasm.scroller_new();
        this.__wbg_ptr = ret;
        ScrollerFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    place() {
        wasm.scroller_place(this.__wbg_ptr);
    }
    /**
     * @returns {number}
     */
    get position() {
        const ret = wasm.scroller_position(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {boolean}
     */
    get running() {
        const ret = wasm.scroller_running(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @param {number} value
     */
    set position(value) {
        wasm.scroller_set_position(this.__wbg_ptr, value);
    }
    /**
     * @param {number} value
     */
    set target(value) {
        wasm.scroller_set_target(this.__wbg_ptr, value);
    }
    /**
     * @param {number} value
     */
    set velocity(value) {
        wasm.scroller_set_velocity(this.__wbg_ptr, value);
    }
    /**
     * @param {number} by
     */
    shiftGlide(by) {
        wasm.scroller_shiftGlide(this.__wbg_ptr, by);
    }
    /**
     * @param {number} from
     * @param {number} now
     */
    startGlide(from, now) {
        wasm.scroller_startGlide(this.__wbg_ptr, from, now);
    }
    /**
     * @param {number} now
     */
    start(now) {
        wasm.scroller_start(this.__wbg_ptr, now);
    }
    stopGlide() {
        wasm.scroller_stopGlide(this.__wbg_ptr);
    }
    /**
     * @returns {number}
     */
    get target() {
        const ret = wasm.scroller_target(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} now
     * @returns {number}
     */
    tick(now) {
        const ret = wasm.scroller_tick(this.__wbg_ptr, now);
        return ret;
    }
    /**
     * @returns {number}
     */
    get velocity() {
        const ret = wasm.scroller_velocity(this.__wbg_ptr);
        return ret;
    }
}
if (Symbol.dispose) Scroller.prototype[Symbol.dispose] = Scroller.prototype.free;

export class Spline {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SplineFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_spline_free(ptr, 0);
    }
    /**
     * @param {number} x
     * @returns {number}
     */
    at(x) {
        const ret = wasm.spline_at(this.__wbg_ptr, x);
        return ret;
    }
    /**
     * Points as `x, y` pairs.
     * @param {Float64Array} points
     */
    constructor(points) {
        const ptr0 = passArrayF64ToWasm0(points, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.spline_new(ptr0, len0);
        this.__wbg_ptr = ret;
        SplineFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
}
if (Symbol.dispose) Spline.prototype[Symbol.dispose] = Spline.prototype.free;

export class Spring {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SpringFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_spring_free(ptr, 0);
    }
    /**
     * @returns {boolean}
     */
    get asleep() {
        const ret = wasm.spring_asleep(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {number}
     */
    get damping() {
        const ret = wasm.spring_damping(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get goal() {
        const ret = wasm.spring_goal(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} position
     * @param {number} frequency
     * @param {number} damping
     */
    constructor(position, frequency, damping) {
        const ret = wasm.spring_new(position, frequency, damping);
        this.__wbg_ptr = ret;
        SpringFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {number}
     */
    get position() {
        const ret = wasm.spring_position(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} value
     */
    set damping(value) {
        wasm.spring_set_damping(this.__wbg_ptr, value);
    }
    /**
     * @param {number} value
     */
    set goal(value) {
        wasm.spring_set_goal(this.__wbg_ptr, value);
    }
    /**
     * @param {number} value
     */
    set position(value) {
        wasm.spring_set_position(this.__wbg_ptr, value);
    }
    /**
     * @param {number} value
     */
    set velocity(value) {
        wasm.spring_set_velocity(this.__wbg_ptr, value);
    }
    /**
     * @param {number} seconds
     * @returns {number}
     */
    step(seconds) {
        const ret = wasm.spring_step(this.__wbg_ptr, seconds);
        return ret;
    }
    /**
     * @returns {number}
     */
    get velocity() {
        const ret = wasm.spring_velocity(this.__wbg_ptr);
        return ret;
    }
}
if (Symbol.dispose) Spring.prototype[Symbol.dispose] = Spring.prototype.free;

/**
 * One rendered syllable of a live line, with its held word's letters. The
 * animator steps it every frame and writes the values it returns.
 */
export class Syllable {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SyllableFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_syllable_free(ptr, 0);
    }
    /**
     * `letters` is how many of the held word's letters this piece shows,
     * starting at `letter_offset` of `letter_count`.
     * @param {number} start
     * @param {number} end
     * @param {boolean} emphasis
     * @param {number} letters
     * @param {number} letter_offset
     * @param {number} letter_count
     * @param {number} calm
     * @param {boolean} simple
     */
    constructor(start, end, emphasis, letters, letter_offset, letter_count, calm, simple) {
        const ret = wasm.syllable_new(start, end, emphasis, letters, letter_offset, letter_count, calm, simple);
        this.__wbg_ptr = ret;
        SyllableFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Steps the springs to song `time` and reports whether any still move.
     * @param {number} time
     * @param {number} seconds
     * @param {boolean} reduce_motion
     * @returns {boolean}
     */
    step(time, seconds, reduce_motion) {
        const ret = wasm.syllable_step(this.__wbg_ptr, time, seconds, reduce_motion);
        return ret !== 0;
    }
    /**
     * The values the last step produced, piece by piece, word first.
     * @returns {Float64Array}
     */
    values() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.syllable_values(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayF64FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export3(r0, r1 * 8, 8);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
}
if (Symbol.dispose) Syllable.prototype[Symbol.dispose] = Syllable.prototype.free;

/**
 * @param {Float64Array} body
 * @param {Float64Array} rect
 * @returns {boolean}
 */
export function bodyIntersects(body, rect) {
    const ptr0 = passArrayF64ToWasm0(body, wasm.__wbindgen_export);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayF64ToWasm0(rect, wasm.__wbindgen_export);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.bodyIntersects(ptr0, len0, ptr1, len1);
    return ret !== 0;
}

/**
 * @param {Float64Array} body
 * @param {Float64Array} field
 * @returns {Float64Array}
 */
export function constrainBody(body, field) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArrayF64ToWasm0(body, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(field, wasm.__wbindgen_export);
        const len1 = WASM_VECTOR_LEN;
        wasm.constrainBody(retptr, ptr0, len0, ptr1, len1);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var v3 = getArrayF64FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export3(r0, r1 * 8, 8);
        return v3;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Three dots as `opacity, scale, glow, lift` fours.
 * @param {number} gap_start
 * @param {number} gap_end
 * @param {number} time
 * @param {boolean} reduce_motion
 * @returns {Float64Array}
 */
export function countdownDots(gap_start, gap_end, time, reduce_motion) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.countdownDots(retptr, gap_start, gap_end, time, reduce_motion);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var v1 = getArrayF64FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export3(r0, r1 * 8, 8);
        return v1;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * @param {number} gap_start
 * @param {number} gap_end
 * @param {number} position
 * @returns {number}
 */
export function countdownTime(gap_start, gap_end, position) {
    const ret = wasm.countdownTime(gap_start, gap_end, position);
    return ret;
}

/**
 * @param {number} gap_start
 * @param {number} gap_end
 * @param {number} time
 * @returns {boolean}
 */
export function countdownVisible(gap_start, gap_end, time) {
    const ret = wasm.countdownVisible(gap_start, gap_end, time);
    return ret !== 0;
}

/**
 * @param {number} seed
 * @param {number} speed
 * @param {number} line_start
 * @param {number} order
 * @returns {Float64Array}
 */
export function createBody(seed, speed, line_start, order) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.createBody(retptr, seed, speed, line_start, order);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var v1 = getArrayF64FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export3(r0, r1 * 8, 8);
        return v1;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * @param {boolean} playing
 * @param {number} position
 * @param {number} clicked_at
 * @param {number} line_start
 * @returns {boolean}
 */
export function cueHolds(playing, position, clicked_at, line_start) {
    const ret = wasm.cueHolds(playing, position, clicked_at, line_start);
    return ret !== 0;
}

/**
 * @param {number} from
 * @param {number} to
 * @param {number} elapsed
 * @returns {number}
 */
export function glideScroll(from, to, elapsed) {
    const ret = wasm.glideScroll(from, to, elapsed);
    return ret;
}

/**
 * @param {string} text
 * @returns {number}
 */
export function gravityHash(text) {
    const ptr0 = passStringToWasm0(text, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.gravityHash(ptr0, len0);
    return ret >>> 0;
}

/**
 * @param {number} seed
 * @returns {number}
 */
export function gravityRandom(seed) {
    const ret = wasm.gravityRandom(seed);
    return ret;
}

/**
 * @param {number} target
 * @param {number} line_top
 * @param {boolean} card
 * @param {number} focus
 * @param {number} end
 * @returns {number}
 */
export function heldTarget(target, line_top, card, focus, end) {
    const ret = wasm.heldTarget(target, line_top, card, focus, end);
    return ret;
}

/**
 * @param {number} start
 * @param {number} end
 * @param {string} text
 * @param {boolean} estimated
 * @returns {boolean}
 */
export function isEmphasis(start, end, text, estimated) {
    const ptr0 = passStringToWasm0(text, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.isEmphasis(start, end, ptr0, len0, estimated);
    return ret !== 0;
}

/**
 * @param {boolean} card
 * @param {boolean} compact
 * @param {boolean} stacked
 * @param {number} client_height
 * @param {number} opening
 * @param {number} focus
 * @param {number} first_line_height
 * @returns {number}
 */
export function leadTop(card, compact, stacked, client_height, opening, focus, first_line_height) {
    const ret = wasm.leadTop(card, compact, stacked, client_height, opening, focus, first_line_height);
    return ret;
}

/**
 * @param {number} start
 * @param {number} end
 * @param {number} time
 * @param {number} count
 * @returns {Float64Array}
 */
export function letterGoals(start, end, time, count) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.letterGoals(retptr, start, end, time, count);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var v1 = getArrayF64FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export3(r0, r1 * 8, 8);
        return v1;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * @param {number} distance
 * @returns {number}
 */
export function lineBlur(distance) {
    const ret = wasm.lineBlur(distance);
    return ret;
}

/**
 * Sizes as `width, height` pairs; returns each word's centre pair, then the
 * line height.
 * @param {Float64Array} sizes
 * @param {number} width
 * @param {boolean} opposite
 * @param {number} gap
 * @returns {Float64Array}
 */
export function lineLayout(sizes, width, opposite, gap) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArrayF64ToWasm0(sizes, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        wasm.lineLayout(retptr, ptr0, len0, width, opposite, gap);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var v2 = getArrayF64FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export3(r0, r1 * 8, 8);
        return v2;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Fill position of a line without word timing, or NaN when it should rest.
 * @param {number} start
 * @param {number} end
 * @param {number} time
 * @param {boolean} simple
 * @returns {number}
 */
export function lineWipe(start, end, time, simple) {
    const ret = wasm.lineWipe(start, end, time, simple);
    return ret;
}

/**
 * @param {Float64Array} body
 * @param {number} width
 * @param {number} height
 * @returns {Float64Array}
 */
export function measureBody(body, width, height) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArrayF64ToWasm0(body, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        wasm.measureBody(retptr, ptr0, len0, width, height);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var v2 = getArrayF64FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export3(r0, r1 * 8, 8);
        return v2;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * 0 scale, 1 letter scale, 2 lift, 3 letter lift, 4 glow.
 * @param {number} curve
 * @param {number} x
 * @returns {number}
 */
export function motionCurve(curve, x) {
    const ret = wasm.motionCurve(curve, x);
    return ret;
}

/**
 * Scalars and spring settings, in the order `lyric-motion.ts` reads them.
 * @returns {Float64Array}
 */
export function motionSettings() {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.motionSettings(retptr);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var v1 = getArrayF64FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export3(r0, r1 * 8, 8);
        return v1;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * @param {number} last
 * @param {number} now
 * @returns {boolean}
 */
export function positionJumped(last, now) {
    const ret = wasm.positionJumped(last, now);
    return ret !== 0;
}

/**
 * @param {number} now
 * @param {number} browsed_at
 * @param {number} line_top
 * @param {number} line_bottom
 * @param {number} view_top
 * @param {number} view_bottom
 * @returns {boolean}
 */
export function resumeFollowing(now, browsed_at, line_top, line_bottom, view_top, view_bottom) {
    const ret = wasm.resumeFollowing(now, browsed_at, line_top, line_bottom, view_top, view_bottom);
    return ret !== 0;
}

/**
 * @param {boolean} card
 * @param {number} client_height
 * @returns {number}
 */
export function scrollFocus(card, client_height) {
    const ret = wasm.scrollFocus(card, client_height);
    return ret;
}

/**
 * @param {number} line_top
 * @param {number} line_height
 * @param {boolean} centred
 * @param {number} focus
 * @param {number} client_height
 * @param {number} scroll_height
 * @returns {number}
 */
export function scrollTarget(line_top, line_height, centred, focus, client_height, scroll_height) {
    const ret = wasm.scrollTarget(line_top, line_height, centred, focus, client_height, scroll_height);
    return ret;
}

/**
 * @param {number} start
 * @param {number} end
 * @param {number} time
 * @returns {Float64Array}
 */
export function simpleGoal(start, end, time) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.simpleGoal(retptr, start, end, time);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var v1 = getArrayF64FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export3(r0, r1 * 8, 8);
        return v1;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * @param {Float64Array} body
 * @param {Float64Array} occupied
 * @param {Float64Array} field
 * @param {boolean} reduced
 * @param {number} across
 * @param {number} down
 * @param {number} phase
 * @returns {Float64Array}
 */
export function spawnBody(body, occupied, field, reduced, across, down, phase) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArrayF64ToWasm0(body, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(occupied, wasm.__wbindgen_export);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayF64ToWasm0(field, wasm.__wbindgen_export);
        const len2 = WASM_VECTOR_LEN;
        wasm.spawnBody(retptr, ptr0, len0, ptr1, len1, ptr2, len2, reduced, across, down, phase);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var v4 = getArrayF64FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export3(r0, r1 * 8, 8);
        return v4;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * @param {Float64Array} body
 * @param {Float64Array} other
 * @returns {number}
 */
export function spawnOverlap(body, other) {
    const ptr0 = passArrayF64ToWasm0(body, wasm.__wbindgen_export);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayF64ToWasm0(other, wasm.__wbindgen_export);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.spawnOverlap(ptr0, len0, ptr1, len1);
    return ret;
}

/**
 * @param {Float64Array} word_starts
 * @returns {number}
 */
export function speedMultiplier(word_starts) {
    const ptr0 = passArrayF64ToWasm0(word_starts, wasm.__wbindgen_export);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.speedMultiplier(ptr0, len0);
    return ret;
}

/**
 * `sizes` holds each line's body count; bodies run line after line.
 * @param {Float64Array} bodies
 * @param {Uint32Array} sizes
 * @param {Float64Array} field
 * @returns {Float64Array}
 */
export function staticLayout(bodies, sizes, field) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArrayF64ToWasm0(bodies, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray32ToWasm0(sizes, wasm.__wbindgen_export);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayF64ToWasm0(field, wasm.__wbindgen_export);
        const len2 = WASM_VECTOR_LEN;
        wasm.staticLayout(retptr, ptr0, len0, ptr1, len1, ptr2, len2);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var v4 = getArrayF64FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export3(r0, r1 * 8, 8);
        return v4;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Steps shown bodies and fading ones together; returns both, shown first.
 * @param {Float64Array} bodies
 * @param {number} dt
 * @param {Float64Array} field
 * @param {number} window_vx
 * @param {number} window_vy
 * @param {Float64Array} exiting
 * @returns {Float64Array}
 */
export function stepBodies(bodies, dt, field, window_vx, window_vy, exiting) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArrayF64ToWasm0(bodies, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(field, wasm.__wbindgen_export);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayF64ToWasm0(exiting, wasm.__wbindgen_export);
        const len2 = WASM_VECTOR_LEN;
        wasm.stepBodies(retptr, ptr0, len0, dt, ptr1, len1, window_vx, window_vy, ptr2, len2);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var v4 = getArrayF64FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export3(r0, r1 * 8, 8);
        return v4;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * @param {number} position
 * @param {number} velocity
 * @param {number} target
 * @param {number} seconds
 * @returns {Float64Array}
 */
export function stepScroll(position, velocity, target, seconds) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.stepScroll(retptr, position, velocity, target, seconds);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var v1 = getArrayF64FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export3(r0, r1 * 8, 8);
        return v1;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * 0 unsung, 1 active, 2 sung.
 * @param {number} start
 * @param {number} end
 * @param {number} time
 * @returns {number}
 */
export function sungState(start, end, time) {
    const ret = wasm.sungState(start, end, time);
    return ret;
}

/**
 * Window motion as `x, y, vx, vy`, with NaN x and y before the first sample.
 * @param {Float64Array} motion
 * @param {number} x
 * @param {number} y
 * @param {number} dt
 * @returns {Float64Array}
 */
export function trackWindow(motion, x, y, dt) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArrayF64ToWasm0(motion, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        wasm.trackWindow(retptr, ptr0, len0, x, y, dt);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var v2 = getArrayF64FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export3(r0, r1 * 8, 8);
        return v2;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * @param {boolean} legacy
 * @param {number} idle_scale
 * @param {number} word_peak_scale
 * @param {number} letter_peak_scale
 * @param {number} vertical_strength
 * @param {number} glow_strength
 * @param {number} scale_frequency
 * @param {number} scale_damping
 * @param {number} vertical_frequency
 * @param {number} vertical_damping
 * @param {number} glow_frequency
 * @param {number} glow_damping
 * @param {number} blur_strength
 */
export function tuneMotion(legacy, idle_scale, word_peak_scale, letter_peak_scale, vertical_strength, glow_strength, scale_frequency, scale_damping, vertical_frequency, vertical_damping, glow_frequency, glow_damping, blur_strength) {
    wasm.tuneMotion(legacy, idle_scale, word_peak_scale, letter_peak_scale, vertical_strength, glow_strength, scale_frequency, scale_damping, vertical_frequency, vertical_damping, glow_frequency, glow_damping, blur_strength);
}

/**
 * @param {Float64Array} field
 * @returns {number}
 */
export function visibleWordCount(field) {
    const ptr0 = passArrayF64ToWasm0(field, wasm.__wbindgen_export);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.visibleWordCount(ptr0, len0);
    return ret;
}

/**
 * @param {number} end
 * @param {Float64Array} word_ends
 * @returns {number}
 */
export function vocalEnd(end, word_ends) {
    const ptr0 = passArrayF64ToWasm0(word_ends, wasm.__wbindgen_export);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.vocalEnd(end, ptr0, len0);
    return ret;
}

/**
 * @param {number} start
 * @param {number} end
 * @param {number} time
 * @returns {Float64Array}
 */
export function wordGoal(start, end, time) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.wordGoal(retptr, start, end, time);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var v1 = getArrayF64FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export3(r0, r1 * 8, 8);
        return v1;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * @param {string[]} texts
 * @returns {Uint32Array}
 */
export function wordGroupSizes(texts) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArrayJsValueToWasm0(texts, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        wasm.wordGroupSizes(retptr, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var v2 = getArrayU32FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export3(r0, r1 * 4, 4);
        return v2;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * @param {number} anchor
 * @param {number} total
 * @param {number} count
 * @returns {Float64Array}
 */
export function wordWindow(anchor, total, count) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.wordWindow(retptr, anchor, total, count);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var v1 = getArrayF64FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export3(r0, r1 * 8, 8);
        return v1;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_string_get_0380ccaa2f57f0d9: function(arg0, arg1) {
            const obj = getObject(arg1);
            const ret = typeof(obj) === 'string' ? obj : undefined;
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_throw_41e9ee4f547fc59a: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbindgen_generic_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return addHeapObject(ret);
        },
        __wbindgen_object_drop_ref: function(arg0) {
            takeObject(arg0);
        },
    };
    return {
        __proto__: null,
        "./lyric_engine_bg.js": import0,
    };
}

const CountdownFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_countdown_free(ptr, 1));
const GravityPiecesFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_gravitypieces_free(ptr, 1));
const LyricLinesFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_lyriclines_free(ptr, 1));
const ScrollerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_scroller_free(ptr, 1));
const SplineFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_spline_free(ptr, 1));
const SpringFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_spring_free(ptr, 1));
const SyllableFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_syllable_free(ptr, 1));

function addHeapObject(obj) {
    if (heap_next === heap.length) heap.push(heap.length + 1);
    const idx = heap_next;
    heap_next = heap[idx];

    heap[idx] = obj;
    return idx;
}

function dropObject(idx) {
    if (idx < 1028) return;
    heap[idx] = heap_next;
    heap_next = idx;
}

function getArrayF64FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat64ArrayMemory0().subarray(ptr / 8, ptr / 8 + len);
}

function getArrayJsValueFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    const mem = getDataViewMemory0();
    const result = [];
    for (let i = ptr; i < ptr + 4 * len; i += 4) {
        result.push(takeObject(mem.getUint32(i, true)));
    }
    return result;
}

function getArrayU32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

let cachedFloat64ArrayMemory0 = null;
function getFloat64ArrayMemory0() {
    if (cachedFloat64ArrayMemory0 === null || cachedFloat64ArrayMemory0.byteLength === 0) {
        cachedFloat64ArrayMemory0 = new Float64Array(wasm.memory.buffer);
    }
    return cachedFloat64ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint32ArrayMemory0 = null;
function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function getObject(idx) { return heap[idx]; }

let heap = new Array(1024).fill(undefined);
heap.push(undefined, null, true, false);

let heap_next = heap.length;

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passArray32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getUint32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayF64ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 8, 8) >>> 0;
    getFloat64ArrayMemory0().set(arg, ptr / 8);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayJsValueToWasm0(array, malloc) {
    const ptr = malloc(array.length * 4, 4) >>> 0;
    const mem = getDataViewMemory0();
    for (let i = 0; i < array.length; i++) {
        mem.setUint32(ptr + 4 * i, addHeapObject(array[i]), true);
    }
    WASM_VECTOR_LEN = array.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeObject(idx) {
    const ret = getObject(idx);
    dropObject(idx);
    return ret;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedFloat64ArrayMemory0 = null;
    cachedUint32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (!module.ok) {
            throw new Error(`failed to fetch Wasm: ${module.status} ${module.statusText} fetching '${module.url}'`);
        }

        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }


    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
