//! Lyssna's lyric timing and motion. The web view loads this as WebAssembly
//! and keeps only DOM work in TypeScript.

pub mod gravity;
pub mod motion;
pub mod view;

use std::cell::RefCell;

use motion::{CountdownSprings, Dot, DotCurves, Goal, Motion, SyllableSprings, Tuning};
use wasm_bindgen::prelude::*;

thread_local! {
    static MOTION: RefCell<Motion> = RefCell::new(Motion::default());
    static DOTS: DotCurves = DotCurves::default();
}

fn with_motion<T>(read: impl FnOnce(&Motion) -> T) -> T {
    MOTION.with(|motion| read(&motion.borrow()))
}

fn goal_values(goals: &[Goal]) -> Vec<f64> {
    goals
        .iter()
        .flat_map(|goal| [goal.scale, goal.lift, goal.glow, goal.gradient])
        .collect()
}

#[allow(clippy::too_many_arguments)]
#[wasm_bindgen(js_name = tuneMotion)]
pub fn tune_motion(
    legacy: bool,
    idle_scale: f64,
    word_peak_scale: f64,
    letter_peak_scale: f64,
    vertical_strength: f64,
    glow_strength: f64,
    scale_frequency: f64,
    scale_damping: f64,
    vertical_frequency: f64,
    vertical_damping: f64,
    glow_frequency: f64,
    glow_damping: f64,
    blur_strength: f64,
) {
    MOTION.with(|motion| {
        motion.borrow_mut().tune(Tuning {
            legacy,
            idle_scale,
            word_peak_scale,
            letter_peak_scale,
            vertical_strength,
            glow_strength,
            scale_frequency,
            scale_damping,
            vertical_frequency,
            vertical_damping,
            glow_frequency,
            glow_damping,
            blur_strength,
        })
    });
}

/// 0 scale, 1 letter scale, 2 lift, 3 letter lift, 4 glow.
#[wasm_bindgen(js_name = motionCurve)]
pub fn motion_curve(curve: u8, x: f64) -> f64 {
    with_motion(|motion| match curve {
        0 => motion.scale.at(x),
        1 => motion.letter_scale.at(x),
        2 => motion.lift.at(x),
        3 => motion.letter_lift.at(x),
        _ => motion.glow.at(x),
    })
}

/// Scalars and spring settings, in the order `lyric-motion.ts` reads them.
#[wasm_bindgen(js_name = motionSettings)]
pub fn motion_settings() -> Vec<f64> {
    with_motion(|motion| {
        vec![
            motion.idle_scale,
            motion.sung_letter_glow,
            motion.emphasis_tail_ms,
            motion.lead_ms,
            motion.blur_per_line,
            motion.max_blur,
            motion.scale_spring.0,
            motion.scale_spring.1,
            motion.lift_spring.0,
            motion.lift_spring.1,
            motion.glow_spring.0,
            motion.glow_spring.1,
        ]
    })
}

#[wasm_bindgen(js_name = wordGoal)]
pub fn word_goal(start: f64, end: f64, time: f64) -> Vec<f64> {
    with_motion(|motion| goal_values(&[motion.word_goal(start, end, time)]))
}

#[wasm_bindgen(js_name = letterGoals)]
pub fn letter_goals(start: f64, end: f64, time: f64, count: usize) -> Vec<f64> {
    with_motion(|motion| goal_values(&motion.letter_goals(start, end, time, count)))
}

#[wasm_bindgen(js_name = simpleGoal)]
pub fn simple_goal(start: f64, end: f64, time: f64) -> Vec<f64> {
    goal_values(&[motion::simple_goal(start, end, time)])
}

/// 0 unsung, 1 active, 2 sung.
#[wasm_bindgen(js_name = sungState)]
pub fn sung_state(start: f64, end: f64, time: f64) -> u8 {
    motion::sung(start, end, time) as u8
}

#[wasm_bindgen(js_name = lineBlur)]
pub fn line_blur(distance: f64) -> f64 {
    with_motion(|motion| motion.line_blur(distance))
}

#[wasm_bindgen(js_name = glideScroll)]
pub fn glide_scroll(from: f64, to: f64, elapsed: f64) -> f64 {
    motion::glide_scroll(from, to, elapsed)
}

#[wasm_bindgen(js_name = stepScroll)]
pub fn step_scroll(position: f64, velocity: f64, target: f64, seconds: f64) -> Vec<f64> {
    let (position, velocity) = motion::step_scroll(position, velocity, target, seconds);
    vec![position, velocity]
}

#[wasm_bindgen(js_name = vocalEnd)]
pub fn vocal_end(end: f64, word_ends: &[f64]) -> f64 {
    motion::Line {
        end,
        word_ends: word_ends.to_vec(),
        ..Default::default()
    }
    .vocal_end()
}

fn gap_values(gap: &motion::VocalGap) -> [f64; 4] {
    [gap.start, gap.end, gap.after as f64, gap.opposite]
}

#[wasm_bindgen(js_name = isEmphasis)]
pub fn is_emphasis(start: f64, end: f64, text: &str, estimated: bool) -> bool {
    motion::is_emphasis(start, end, text, estimated)
}

#[wasm_bindgen(js_name = wordGroupSizes)]
pub fn word_group_sizes(texts: Vec<String>) -> Vec<u32> {
    motion::word_group_sizes(texts.iter().map(String::as_str))
        .into_iter()
        .map(|size| size as u32)
        .collect()
}

fn dot_values(dots: &[Dot]) -> Vec<f64> {
    dots.iter()
        .flat_map(|dot| [dot.opacity, dot.scale, dot.glow, dot.lift])
        .collect()
}

fn dots_from(values: &[f64]) -> Vec<Dot> {
    values
        .as_chunks::<4>()
        .0
        .iter()
        .map(|&[opacity, scale, glow, lift]| Dot {
            opacity,
            scale,
            glow,
            lift,
        })
        .collect()
}

#[wasm_bindgen(js_name = countdownVisible)]
pub fn countdown_visible(gap_start: f64, gap_end: f64, time: f64) -> bool {
    motion::countdown_visible(gap_start, gap_end, time)
}

/// Three dots as `opacity, scale, glow, lift` fours.
#[wasm_bindgen(js_name = countdownDots)]
pub fn countdown_dots(gap_start: f64, gap_end: f64, time: f64, reduce_motion: bool) -> Vec<f64> {
    DOTS.with(|curves| dot_values(&curves.dots(gap_start, gap_end, time, reduce_motion)))
}

#[wasm_bindgen]
pub struct Spline(motion::Spline);

#[wasm_bindgen]
impl Spline {
    /// Points as `x, y` pairs.
    #[wasm_bindgen(constructor)]
    pub fn new(points: &[f64]) -> Self {
        let pairs: Vec<(f64, f64)> = points
            .as_chunks::<2>()
            .0
            .iter()
            .map(|&[x, y]| (x, y))
            .collect();
        Self(motion::Spline::new(&pairs))
    }

    pub fn at(&self, x: f64) -> f64 {
        self.0.at(x)
    }
}

#[wasm_bindgen]
pub struct Spring(motion::Spring);

#[wasm_bindgen]
impl Spring {
    #[wasm_bindgen(constructor)]
    pub fn new(position: f64, frequency: f64, damping: f64) -> Self {
        Self(motion::Spring::new(position, frequency, damping))
    }

    pub fn step(&mut self, seconds: f64) -> f64 {
        self.0.step(seconds)
    }

    #[wasm_bindgen(getter)]
    pub fn position(&self) -> f64 {
        self.0.position
    }

    #[wasm_bindgen(setter)]
    pub fn set_position(&mut self, value: f64) {
        self.0.position = value;
    }

    #[wasm_bindgen(getter)]
    pub fn velocity(&self) -> f64 {
        self.0.velocity
    }

    #[wasm_bindgen(setter)]
    pub fn set_velocity(&mut self, value: f64) {
        self.0.velocity = value;
    }

    #[wasm_bindgen(getter)]
    pub fn goal(&self) -> f64 {
        self.0.goal
    }

    #[wasm_bindgen(setter)]
    pub fn set_goal(&mut self, value: f64) {
        self.0.goal = value;
    }

    #[wasm_bindgen(getter)]
    pub fn damping(&self) -> f64 {
        self.0.damping
    }

    #[wasm_bindgen(setter)]
    pub fn set_damping(&mut self, value: f64) {
        self.0.damping = value;
    }

    #[wasm_bindgen(getter)]
    pub fn asleep(&self) -> bool {
        self.0.asleep()
    }
}

#[wasm_bindgen]
#[derive(Default)]
pub struct Countdown(CountdownSprings);

#[wasm_bindgen]
impl Countdown {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self::default()
    }

    /// Targets and result as `opacity, scale, glow, lift` fours.
    pub fn frame(&mut self, targets: &[f64], time: f64, now: f64, snap: bool) -> Vec<f64> {
        dot_values(&self.0.frame(&dots_from(targets), time, now, snap))
    }
}

/// Values per piece: fill position (percent), scale, lift (em), glow radius
/// (px) and glow opacity (percent). NaN leaves a style untouched.
pub const PIECE_VALUES: usize = 5;

/// One rendered syllable of a live line, with its held word's letters. The
/// animator steps it every frame and writes the values it returns.
#[wasm_bindgen]
pub struct Syllable {
    start: f64,
    end: f64,
    letter_offset: usize,
    letter_count: usize,
    calm: f64,
    simple: bool,
    word: SyllableSprings,
    letters: Vec<SyllableSprings>,
    values: Vec<f64>,
}

#[wasm_bindgen]
impl Syllable {
    /// `letters` is how many of the held word's letters this piece shows,
    /// starting at `letter_offset` of `letter_count`.
    #[allow(clippy::too_many_arguments)]
    #[wasm_bindgen(constructor)]
    pub fn new(
        start: f64,
        end: f64,
        emphasis: bool,
        letters: usize,
        letter_offset: usize,
        letter_count: usize,
        calm: f64,
        simple: bool,
    ) -> Self {
        with_motion(|motion| {
            let mut word = motion.springs(motion.scale.at(0.0), motion.lift.at(0.0));
            if simple {
                let rest = motion::simple_goal(1.0, 2.0, 0.0).lift;
                word.lift.position = rest;
                word.lift.goal = rest;
            }
            Self {
                start,
                end: end
                    - if emphasis {
                        motion.emphasis_tail_ms
                    } else {
                        0.0
                    },
                letter_offset,
                letter_count: if letters > 0 && letter_count == 0 {
                    letters
                } else {
                    letter_count
                },
                calm,
                simple,
                word,
                letters: (0..letters)
                    .map(|_| {
                        motion.springs(motion.letter_scale.at(0.0), motion.letter_lift.at(0.0))
                    })
                    .collect(),
                values: vec![f64::NAN; PIECE_VALUES * (1 + letters)],
            }
        })
    }

    /// Steps the springs to song `time` and reports whether any still move.
    pub fn step(&mut self, time: f64, seconds: f64, reduce_motion: bool) -> bool {
        self.values.fill(f64::NAN);
        if self.simple {
            self.step_simple(time, seconds, reduce_motion)
        } else {
            with_motion(|motion| {
                self.step_full(motion, time + motion.lead_ms, seconds, reduce_motion)
            })
        }
    }

    /// The values the last step produced, piece by piece, word first.
    pub fn values(&self) -> Vec<f64> {
        self.values.clone()
    }

    fn set(&mut self, piece: usize, slot: usize, value: f64) {
        self.values[piece * PIECE_VALUES + slot] = value;
    }

    fn step_simple(&mut self, time: f64, seconds: f64, reduce_motion: bool) -> bool {
        let goal = motion::simple_goal(self.start, self.end, time);
        if self.letters.is_empty() {
            self.set(0, 0, goal.gradient);
        } else {
            let share = (self.end - self.start) / self.letter_count.max(1) as f64;
            for part in 0..self.letters.len() {
                let from = self.start + (self.letter_offset + part) as f64 * share;
                let fill = motion::simple_goal(from, from + share, time).gradient;
                self.set(1 + part, 0, fill);
            }
        }
        if reduce_motion {
            return false;
        }
        let lift = self.word.step(goal, seconds).lift;
        self.set(0, 2, lift);
        !self.word.lift.asleep()
    }

    fn apply(
        &mut self,
        piece: usize,
        goal: Goal,
        seconds: f64,
        glow: Option<(f64, f64)>,
        reduce_motion: bool,
    ) {
        if glow.is_some() {
            self.set(piece, 0, goal.gradient);
        }
        if reduce_motion {
            return;
        }
        let springs = if piece == 0 {
            &mut self.word
        } else {
            &mut self.letters[piece - 1]
        };
        let pose = springs.step(goal, seconds);
        let calm = self.calm;
        self.set(piece, 1, 1.0 + (pose.scale - 1.0) * calm);
        self.set(piece, 2, pose.lift * calm);
        if let Some((radius, opacity)) = glow {
            self.set(piece, 3, 4.0 + radius * pose.glow * calm);
            self.set(piece, 4, (pose.glow * opacity * calm).clamp(0.0, 100.0));
        }
    }

    fn step_full(
        &mut self,
        motion: &Motion,
        ahead: f64,
        seconds: f64,
        reduce_motion: bool,
    ) -> bool {
        let goal = motion.word_goal(self.start, self.end, ahead);
        let word_glow = self.letters.is_empty().then_some((2.0, 35.0));
        self.apply(0, goal, seconds, word_glow, reduce_motion);
        if ahead >= self.end {
            for letter in &mut self.letters {
                letter.settle();
            }
        }
        if !self.letters.is_empty() {
            let goals = motion.letter_goals(self.start, self.end, ahead, self.letter_count);
            for part in 0..self.letters.len() {
                let Some(goal) = goals.get(self.letter_offset + part).copied() else {
                    break;
                };
                self.apply(1 + part, goal, seconds, Some((12.0, 185.0)), reduce_motion);
            }
        }
        !reduce_motion
            && (!self.word.asleep() || self.letters.iter().any(|letter| !letter.asleep()))
    }
}

/// A song's lines, parsed once and kept in the engine for the view's
/// per-frame questions.
#[wasm_bindgen]
pub struct LyricLines(Vec<motion::Line>);

#[wasm_bindgen]
impl LyricLines {
    /// Lines as `start, end, opposite, background, word count, word ends…`.
    #[wasm_bindgen(constructor)]
    pub fn new(flat: &[f64]) -> Self {
        Self(motion::lines_from_flat(flat))
    }

    #[wasm_bindgen(js_name = vocalEnd)]
    pub fn vocal_end(&self, index: usize) -> f64 {
        self.0.get(index).map_or(0.0, motion::Line::vocal_end)
    }

    /// Gaps as `start, end, after, opposite` fours.
    #[wasm_bindgen(js_name = vocalGaps)]
    pub fn vocal_gaps(&self) -> Vec<f64> {
        motion::vocal_gaps(&self.0)
            .iter()
            .flat_map(gap_values)
            .collect()
    }

    #[wasm_bindgen(js_name = vocalGap)]
    pub fn vocal_gap(&self, time: f64) -> Vec<f64> {
        motion::vocal_gap(&self.0, time)
            .map(|gap| gap_values(&gap).to_vec())
            .unwrap_or_default()
    }

    #[wasm_bindgen(js_name = activeLines)]
    pub fn active_lines(&self, time: f64) -> Vec<u32> {
        view::active_lines(&self.0, time)
            .into_iter()
            .map(|index| index as u32)
            .collect()
    }

    /// `cued` is the line clicked while paused, or -1.
    #[wasm_bindgen(js_name = primaryLine)]
    pub fn primary_line(&self, time: f64, cued: i32) -> u32 {
        view::primary_line(&self.0, time, usize::try_from(cued).ok()) as u32
    }

    #[wasm_bindgen(js_name = highlighterTime)]
    pub fn highlighter_time(
        &self,
        index: usize,
        highlighter: bool,
        playing: bool,
        time: f64,
    ) -> f64 {
        self.0.get(index).map_or(0.0, |line| {
            view::highlighter_time(highlighter, playing, time, line)
        })
    }

    #[wasm_bindgen(js_name = allSung)]
    pub fn all_sung(&self, time: f64) -> bool {
        view::all_sung(&self.0, time)
    }

    #[wasm_bindgen(js_name = endsOnRight)]
    pub fn ends_on_right(&self, mirrored: bool) -> bool {
        view::ends_on_right(&self.0, mirrored)
    }
}

#[wasm_bindgen(js_name = positionJumped)]
pub fn position_jumped(last: f64, now: f64) -> bool {
    view::jumped(last, now)
}

#[wasm_bindgen(js_name = cueHolds)]
pub fn cue_holds(playing: bool, position: f64, clicked_at: f64, line_start: f64) -> bool {
    view::cue_holds(playing, position, clicked_at, line_start)
}

#[wasm_bindgen(js_name = countdownTime)]
pub fn countdown_time(gap_start: f64, gap_end: f64, position: f64) -> f64 {
    view::countdown_time(gap_start, gap_end, position)
}

#[wasm_bindgen(js_name = scrollFocus)]
pub fn scroll_focus(card: bool, client_height: f64) -> f64 {
    view::focus(card, client_height)
}

#[allow(clippy::too_many_arguments)]
#[wasm_bindgen(js_name = leadTop)]
pub fn lead_top(
    card: bool,
    compact: bool,
    stacked: bool,
    client_height: f64,
    opening: f64,
    focus: f64,
    first_line_height: f64,
) -> f64 {
    view::lead_top(
        card,
        compact,
        stacked,
        client_height,
        opening,
        focus,
        first_line_height,
    )
}

#[wasm_bindgen(js_name = scrollTarget)]
pub fn scroll_target(
    line_top: f64,
    line_height: f64,
    centred: bool,
    focus: f64,
    client_height: f64,
    scroll_height: f64,
) -> f64 {
    view::scroll_target(
        line_top,
        line_height,
        centred,
        focus,
        client_height,
        scroll_height,
    )
}

#[wasm_bindgen(js_name = heldTarget)]
pub fn held_target(target: f64, line_top: f64, card: bool, focus: f64, end: f64) -> f64 {
    view::held_target(target, line_top, card, focus, end)
}

#[wasm_bindgen(js_name = resumeFollowing)]
pub fn resume_following(
    now: f64,
    browsed_at: f64,
    line_top: f64,
    line_bottom: f64,
    view_top: f64,
    view_bottom: f64,
) -> bool {
    view::resume_following(
        now,
        browsed_at,
        line_top,
        line_bottom,
        view_top,
        view_bottom,
    )
}

/// The lyrics scroll position: a spring between lines and a glide after
/// seeks.
#[wasm_bindgen]
#[derive(Default)]
pub struct Scroller(view::Scroller);

#[wasm_bindgen]
impl Scroller {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self::default()
    }

    #[wasm_bindgen(getter)]
    pub fn position(&self) -> f64 {
        self.0.position
    }

    #[wasm_bindgen(setter)]
    pub fn set_position(&mut self, value: f64) {
        self.0.position = value;
    }

    #[wasm_bindgen(getter)]
    pub fn velocity(&self) -> f64 {
        self.0.velocity
    }

    #[wasm_bindgen(setter)]
    pub fn set_velocity(&mut self, value: f64) {
        self.0.velocity = value;
    }

    #[wasm_bindgen(getter)]
    pub fn target(&self) -> f64 {
        self.0.target
    }

    #[wasm_bindgen(setter)]
    pub fn set_target(&mut self, value: f64) {
        self.0.target = value;
    }

    #[wasm_bindgen(getter)]
    pub fn gliding(&self) -> bool {
        self.0.gliding()
    }

    #[wasm_bindgen(getter)]
    pub fn running(&self) -> bool {
        self.0.running()
    }

    #[wasm_bindgen(js_name = startGlide)]
    pub fn start_glide(&mut self, from: f64, now: f64) {
        self.0.start_glide(from, now);
    }

    #[wasm_bindgen(js_name = shiftGlide)]
    pub fn shift_glide(&mut self, by: f64) {
        self.0.shift_glide(by);
    }

    #[wasm_bindgen(js_name = stopGlide)]
    pub fn stop_glide(&mut self) {
        self.0.stop_glide();
    }

    pub fn start(&mut self, now: f64) {
        self.0.start(now);
    }

    pub fn place(&mut self) {
        self.0.place();
    }

    pub fn tick(&mut self, now: f64) -> f64 {
        self.0.tick(now)
    }
}

/// Fill position of a line without word timing, or NaN when it should rest.
#[wasm_bindgen(js_name = lineWipe)]
pub fn line_wipe(start: f64, end: f64, time: f64, simple: bool) -> f64 {
    if simple || time < start - 1000.0 {
        return f64::NAN;
    }
    let span = if end - start == 0.0 { 1.0 } else { end - start };
    120.0 * ((time - start) / span).clamp(0.0, 1.0) - 20.0
}

fn rect_at(values: &[f64], at: usize) -> Option<gravity::Rect> {
    let rect = values.get(at..at + 4)?;
    rect[0].is_finite().then(|| gravity::Rect {
        left: rect[0],
        top: rect[1],
        right: rect[2],
        bottom: rect[3],
    })
}

/// Fields as `width, height`, then `area, layout, cover, footer` rects of
/// four (NaN when absent), then any blocker rects.
fn field_from(values: &[f64]) -> gravity::Field {
    gravity::Field {
        width: values.first().copied().unwrap_or(0.0),
        height: values.get(1).copied().unwrap_or(0.0),
        area: rect_at(values, 2),
        layout: rect_at(values, 6),
        cover: rect_at(values, 10),
        footer: rect_at(values, 14),
        blockers: (18..values.len())
            .step_by(4)
            .filter_map(|at| rect_at(values, at))
            .collect(),
    }
}

fn bodies_from(values: &[f64]) -> Vec<gravity::Body> {
    values
        .chunks(gravity::BODY_VALUES)
        .map(gravity::Body::from_values)
        .collect()
}

fn body_values(bodies: &[gravity::Body]) -> Vec<f64> {
    bodies.iter().flat_map(gravity::Body::to_values).collect()
}

#[wasm_bindgen(js_name = gravityHash)]
pub fn gravity_hash(text: &str) -> u32 {
    gravity::hash(text)
}

#[wasm_bindgen(js_name = gravityRandom)]
pub fn gravity_random(seed: f64) -> f64 {
    gravity::random(seed)
}

#[wasm_bindgen(js_name = speedMultiplier)]
pub fn speed_multiplier(word_starts: &[f64]) -> f64 {
    gravity::speed_multiplier(word_starts)
}

#[wasm_bindgen(js_name = createBody)]
pub fn create_body(seed: f64, speed: f64, line_start: f64, order: f64) -> Vec<f64> {
    gravity::create_body(seed, speed, line_start, order)
        .to_values()
        .to_vec()
}

#[wasm_bindgen(js_name = measureBody)]
pub fn measure_body(body: &[f64], width: f64, height: f64) -> Vec<f64> {
    let mut body = gravity::Body::from_values(body);
    gravity::measure(&mut body, width, height);
    body.to_values().to_vec()
}

#[wasm_bindgen(js_name = constrainBody)]
pub fn constrain_body(body: &[f64], field: &[f64]) -> Vec<f64> {
    let mut body = gravity::Body::from_values(body);
    gravity::constrain(&mut body, &field_from(field));
    body.to_values().to_vec()
}

#[wasm_bindgen(js_name = bodyIntersects)]
pub fn body_intersects(body: &[f64], rect: &[f64]) -> bool {
    gravity::intersects(&gravity::Body::from_values(body), rect_at(rect, 0).as_ref())
}

/// Window motion as `x, y, vx, vy`, with NaN x and y before the first sample.
#[wasm_bindgen(js_name = trackWindow)]
pub fn track_window(motion: &[f64], x: f64, y: f64, dt: f64) -> Vec<f64> {
    let value = |index: usize| motion.get(index).copied().unwrap_or(f64::NAN);
    let mut window = gravity::WindowMotion {
        position: (value(0).is_finite() && value(1).is_finite()).then(|| (value(0), value(1))),
        vx: value(2),
        vy: value(3),
    };
    gravity::track_window(&mut window, Some((x, y)), dt);
    let (x, y) = window.position.unwrap_or((f64::NAN, f64::NAN));
    vec![x, y, window.vx, window.vy]
}

/// Steps shown bodies and fading ones together; returns both, shown first.
#[wasm_bindgen(js_name = stepBodies)]
pub fn step_bodies(
    bodies: &[f64],
    dt: f64,
    field: &[f64],
    window_vx: f64,
    window_vy: f64,
    exiting: &[f64],
) -> Vec<f64> {
    let mut shown = bodies_from(bodies);
    let mut fading = bodies_from(exiting);
    gravity::step(
        &mut shown,
        dt,
        &field_from(field),
        (window_vx, window_vy),
        &mut fading,
    );
    let mut values = body_values(&shown);
    values.extend(body_values(&fading));
    values
}

#[wasm_bindgen(js_name = spawnOverlap)]
pub fn spawn_overlap(body: &[f64], other: &[f64]) -> f64 {
    gravity::spawn_overlap(
        &gravity::Body::from_values(body),
        &gravity::Body::from_values(other),
    )
}

#[allow(clippy::too_many_arguments)]
#[wasm_bindgen(js_name = spawnBody)]
pub fn spawn_body(
    body: &[f64],
    occupied: &[f64],
    field: &[f64],
    reduced: bool,
    across: f64,
    down: f64,
    phase: f64,
) -> Vec<f64> {
    let mut body = gravity::Body::from_values(body);
    gravity::spawn(
        &mut body,
        &bodies_from(occupied),
        &field_from(field),
        reduced,
        [across, down, phase],
    );
    body.to_values().to_vec()
}

/// `sizes` holds each line's body count; bodies run line after line.
#[wasm_bindgen(js_name = staticLayout)]
pub fn static_layout(bodies: &[f64], sizes: &[u32], field: &[f64]) -> Vec<f64> {
    let mut all = bodies_from(bodies).into_iter();
    let mut lines: Vec<Vec<gravity::Body>> = sizes
        .iter()
        .map(|&size| all.by_ref().take(size as usize).collect())
        .collect();
    gravity::static_layout(&mut lines, &field_from(field));
    lines.iter().flat_map(|line| body_values(line)).collect()
}

#[wasm_bindgen(js_name = visibleWordCount)]
pub fn visible_word_count(field: &[f64]) -> f64 {
    gravity::visible_word_count(&field_from(field))
}

#[wasm_bindgen(js_name = wordWindow)]
pub fn word_window(anchor: f64, total: f64, count: f64) -> Vec<f64> {
    gravity::word_window(anchor, total, count)
        .map(|(first, last)| vec![first, last])
        .unwrap_or_default()
}

/// Sizes as `width, height` pairs; returns each word's centre pair, then the
/// line height.
#[wasm_bindgen(js_name = lineLayout)]
pub fn line_layout(sizes: &[f64], width: f64, opposite: bool, gap: f64) -> Vec<f64> {
    let sizes: Vec<(f64, f64)> = sizes
        .as_chunks::<2>()
        .0
        .iter()
        .map(|&[width, height]| (width, height))
        .collect();
    let (places, height) = gravity::line_layout(&sizes, width, opposite, gap);
    let mut values: Vec<f64> = places.into_iter().flat_map(|(x, y)| [x, y]).collect();
    values.push(height);
    values
}

/// A word group split into floating pieces.
#[wasm_bindgen]
pub struct GravityPieces(Vec<gravity::Piece>);

#[wasm_bindgen]
impl GravityPieces {
    /// `timing` holds `start, end, estimated` per word.
    #[wasm_bindgen(constructor)]
    pub fn new(texts: Vec<String>, timing: &[f64]) -> Self {
        let words: Vec<gravity::WordInput> = texts
            .into_iter()
            .zip(timing.as_chunks::<3>().0)
            .map(|(text, &[start, end, estimated])| gravity::WordInput {
                text,
                start,
                end,
                estimated: estimated != 0.0,
            })
            .collect();
        Self(gravity::gravity_pieces(&words))
    }

    pub fn texts(&self) -> Vec<String> {
        self.0.iter().map(|piece| piece.text.clone()).collect()
    }

    /// Per piece: `start, end, first, count, split, word start, word end,
    /// letter offset, letter count` (letters negative when not held).
    pub fn values(&self) -> Vec<f64> {
        self.0
            .iter()
            .flat_map(|piece| {
                [
                    piece.start,
                    piece.end,
                    piece.first as f64,
                    piece.count as f64,
                    if piece.split { 1.0 } else { 0.0 },
                    piece.word_start,
                    piece.word_end,
                    piece.letter_offset,
                    piece.letter_count,
                ]
            })
            .collect()
    }
}
