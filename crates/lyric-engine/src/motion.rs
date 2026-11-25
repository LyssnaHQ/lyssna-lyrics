use std::f64::consts::{FRAC_PI_2, PI};

pub const GAP_MS: f64 = 2500.0;
pub const GLIDE_MS: f64 = 700.0;
pub const DORMANT_DOT_OPACITY: f64 = 0.35;
pub const COUNTDOWN_TAIL_MS: f64 = 550.0;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct VocalGap {
    pub start: f64,
    pub end: f64,
    /// Index of the last line sung before the gap; -1 before the first.
    pub after: i32,
    /// The upcoming line's duet side as the web view passed it: 1 opposite,
    /// 0 not, -1 unset.
    pub opposite: f64,
}

#[derive(Clone, Debug, Default)]
pub struct Line {
    pub start: f64,
    pub end: f64,
    pub opposite: f64,
    pub background: bool,
    pub word_ends: Vec<f64>,
}

impl Line {
    pub fn vocal_end(&self) -> f64 {
        if self.word_ends.is_empty() {
            self.end
        } else {
            self.word_ends.iter().copied().fold(f64::MIN, f64::max)
        }
    }
}

/// Header numbers per flattened line, before its word ends.
pub const LINE_HEADER: usize = 5;

/// Lines flattened as `start, end, opposite, background, word count, word
/// ends…` so the web view can hand them over in one typed array.
pub fn lines_from_flat(flat: &[f64]) -> Vec<Line> {
    let mut lines = Vec::new();
    let mut at = 0;
    while at + LINE_HEADER <= flat.len() {
        let count = flat[at + 4].max(0.0) as usize;
        let ends = flat
            .get(at + LINE_HEADER..at + LINE_HEADER + count)
            .unwrap_or_default();
        lines.push(Line {
            start: flat[at],
            end: flat[at + 1],
            opposite: flat[at + 2],
            background: flat[at + 3] != 0.0,
            word_ends: ends.to_vec(),
        });
        at += LINE_HEADER + count;
    }
    lines
}

pub fn vocal_gaps(lines: &[Line]) -> Vec<VocalGap> {
    let mut intervals: Vec<(f64, f64, usize)> = lines
        .iter()
        .enumerate()
        .map(|(index, line)| (line.start, line.vocal_end(), index))
        .collect();
    intervals.sort_by(|a, b| a.0.total_cmp(&b.0));
    let mut gaps = Vec::new();
    let (mut end, mut after) = (0.0f64, -1i32);
    for (start, finish, index) in intervals {
        if start - end >= GAP_MS {
            gaps.push(VocalGap {
                start: end,
                end: start,
                after,
                opposite: lines[index].opposite,
            });
        }
        if start > end {
            end = finish;
            after = index as i32;
        } else {
            end = end.max(finish);
            after = after.max(index as i32);
        }
    }
    gaps
}

pub fn vocal_gap(lines: &[Line], time: f64) -> Option<VocalGap> {
    let (mut start, mut end, mut after, mut opposite) = (0.0f64, f64::INFINITY, -1i32, -1.0);
    for (index, line) in lines.iter().enumerate() {
        let vocal = line.vocal_end();
        if time >= line.start && time < vocal {
            return None;
        }
        if vocal <= time && vocal >= start {
            start = vocal;
            after = index as i32;
        }
        if line.start > time && line.start < end {
            end = line.start;
            opposite = line.opposite;
        }
    }
    (end.is_finite() && end - start >= GAP_MS).then_some(VocalGap {
        start,
        end,
        after,
        opposite,
    })
}

pub fn glide_scroll(from: f64, to: f64, elapsed: f64) -> f64 {
    let t = (elapsed / GLIDE_MS).clamp(0.0, 1.0);
    let eased = if t < 0.5 {
        4.0 * t.powi(3)
    } else {
        1.0 - (-2.0 * t + 2.0).powi(3) / 2.0
    };
    from + (to - from) * eased
}

/// Analytic critical damping keeps velocity when the target moves, so the
/// view glides from line to line instead of snapping. Returns position and
/// velocity.
pub fn step_scroll(position: f64, velocity: f64, target: f64, seconds: f64) -> (f64, f64) {
    let frequency = 7.0;
    let offset = position - target;
    let combined = velocity + frequency * offset;
    let decay = (-frequency * seconds).exp();
    (
        target + (offset + combined * seconds) * decay,
        (velocity - frequency * combined * seconds) * decay,
    )
}

/// Analytic damped spring ported from Fraktality/spr (MIT). Frequency in hertz.
#[derive(Clone, Copy, Debug)]
pub struct Spring {
    pub position: f64,
    pub velocity: f64,
    pub goal: f64,
    pub frequency: f64,
    pub damping: f64,
}

impl Spring {
    pub fn new(position: f64, frequency: f64, damping: f64) -> Self {
        Self {
            position,
            velocity: 0.0,
            goal: position,
            frequency,
            damping,
        }
    }

    pub fn step(&mut self, seconds: f64) -> f64 {
        let d = self.damping;
        let f = self.frequency * 2.0 * PI;
        let offset = self.position - self.goal;
        let v = self.velocity;
        if d == 1.0 {
            let q = (-f * seconds).exp();
            let w = seconds * q;
            self.position = offset * (q + w * f) + v * w + self.goal;
            self.velocity = v * (q - w * f) - offset * (w * f * f);
        } else if d < 1.0 {
            let q = (-d * f * seconds).exp();
            let c = (1.0 - d * d).sqrt();
            let i = (seconds * f * c).cos();
            let j = (seconds * f * c).sin();
            let z = j / c;
            let y = j / (f * c);
            self.position = (offset * (i + z * d) + v * y) * q + self.goal;
            self.velocity = (v * (i - z * d) - offset * (z * f)) * q;
        } else {
            let c = (d * d - 1.0).sqrt();
            let r1 = -f * (d + c);
            let r2 = -f * (d - c);
            let co2 = (v - offset * r1) / (2.0 * f * c);
            let co1 = (r1 * seconds).exp() * (offset - co2);
            self.position = co1 + co2 * (r2 * seconds).exp() + self.goal;
            self.velocity = co1 * r1 + co2 * (r2 * seconds).exp() * r2;
        }
        self.position
    }

    pub fn asleep(&self) -> bool {
        let offset = self.position - self.goal;
        self.velocity.powi(2) <= 1e-4 && offset.powi(2) <= (1.0f64 / 3840.0).powi(2)
    }
}

/// Natural cubic spline through its points.
#[derive(Clone, Debug)]
pub struct Spline {
    xs: Vec<f64>,
    ys: Vec<f64>,
    slopes: Vec<f64>,
}

impl Spline {
    pub fn new(points: &[(f64, f64)]) -> Self {
        let xs: Vec<f64> = points.iter().map(|point| point.0).collect();
        let ys: Vec<f64> = points.iter().map(|point| point.1).collect();
        let n = xs.len().saturating_sub(1);
        if n == 0 {
            return Self {
                slopes: vec![0.0; xs.len()],
                xs,
                ys,
            };
        }
        let mut below = vec![0.0; n + 1];
        let mut diagonal = vec![0.0; n + 1];
        let mut above = vec![0.0; n + 1];
        let mut right = vec![0.0; n + 1];
        for i in 1..n {
            let l = 1.0 / (xs[i] - xs[i - 1]);
            let r = 1.0 / (xs[i + 1] - xs[i]);
            below[i] = l;
            diagonal[i] = 2.0 * (l + r);
            above[i] = r;
            right[i] = 3.0 * ((ys[i] - ys[i - 1]) * l * l + (ys[i + 1] - ys[i]) * r * r);
        }
        let first = 1.0 / (xs[1] - xs[0]);
        let last = 1.0 / (xs[n] - xs[n - 1]);
        diagonal[0] = 2.0 * first;
        above[0] = first;
        right[0] = 3.0 * (ys[1] - ys[0]) * first * first;
        below[n] = last;
        diagonal[n] = 2.0 * last;
        right[n] = 3.0 * (ys[n] - ys[n - 1]) * last * last;
        for i in 1..=n {
            let m = below[i] / diagonal[i - 1];
            diagonal[i] -= m * above[i - 1];
            right[i] -= m * right[i - 1];
        }
        let mut slopes = right.clone();
        slopes[n] = right[n] / diagonal[n];
        for i in (0..n).rev() {
            slopes[i] = (right[i] - above[i] * slopes[i + 1]) / diagonal[i];
        }
        Self { xs, ys, slopes }
    }

    pub fn at(&self, x: f64) -> f64 {
        let n = self.xs.len().saturating_sub(1);
        if n == 0 {
            return self.ys.first().copied().unwrap_or(0.0);
        }
        let mut i = 1;
        while i < n && self.xs[i] < x {
            i += 1;
        }
        let width = self.xs[i] - self.xs[i - 1];
        let t = (x - self.xs[i - 1]) / width;
        let rise = self.ys[i] - self.ys[i - 1];
        let a = self.slopes[i - 1] * width - rise;
        let b = -self.slopes[i] * width + rise;
        (1.0 - t) * self.ys[i - 1] + t * self.ys[i] + t * (1.0 - t) * (a * (1.0 - t) + b * t)
    }
}

/// Animator preset values, as `animator-tuning.ts` resolves them.
#[derive(Clone, Copy, Debug)]
pub struct Tuning {
    pub legacy: bool,
    pub idle_scale: f64,
    pub word_peak_scale: f64,
    pub letter_peak_scale: f64,
    pub vertical_strength: f64,
    pub glow_strength: f64,
    pub scale_frequency: f64,
    pub scale_damping: f64,
    pub vertical_frequency: f64,
    pub vertical_damping: f64,
    pub glow_frequency: f64,
    pub glow_damping: f64,
    pub blur_strength: f64,
}

#[derive(Clone, Debug)]
pub struct Motion {
    pub scale: Spline,
    pub letter_scale: Spline,
    pub lift: Spline,
    pub letter_lift: Spline,
    pub glow: Spline,
    pub scale_spring: (f64, f64),
    pub lift_spring: (f64, f64),
    pub glow_spring: (f64, f64),
    pub idle_scale: f64,
    pub sung_letter_glow: f64,
    pub emphasis_tail_ms: f64,
    pub lead_ms: f64,
    pub blur_per_line: f64,
    pub max_blur: f64,
}

impl Default for Motion {
    fn default() -> Self {
        Self {
            scale: Spline::new(&[(0.0, 1.0), (0.7, 1.075), (1.0, 1.0)]),
            letter_scale: Spline::new(&[(0.0, 1.0), (0.7, 1.175), (1.0, 1.0)]),
            lift: Spline::new(&[(0.0, 1.0 / 100.0), (0.9, -1.0 / 60.0), (1.0, 0.0)]),
            letter_lift: Spline::new(&[(0.0, 0.0), (0.9, -1.0 / 56.0), (1.0, 0.0)]),
            glow: Spline::new(&[(0.0, 0.0), (0.15, 1.0), (0.6, 1.0), (1.0, 0.0)]),
            scale_spring: (0.88, 0.64),
            lift_spring: (1.45, 0.4),
            glow_spring: (1.18, 0.56),
            idle_scale: 1.0,
            sung_letter_glow: 0.2,
            emphasis_tail_ms: 250.0,
            lead_ms: 90.0,
            blur_per_line: 1.25,
            max_blur: 1.25 * 5.465,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Sung {
    Unsung,
    Active,
    Sung,
}

pub fn sung(start: f64, end: f64, time: f64) -> Sung {
    if time < start {
        Sung::Unsung
    } else if time >= end {
        Sung::Sung
    } else {
        Sung::Active
    }
}

fn progress(start: f64, end: f64, time: f64) -> f64 {
    if time <= start {
        0.0
    } else if time >= end {
        1.0
    } else {
        (time - start) / (end - start)
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Goal {
    pub scale: f64,
    /// In font sizes; negative is up.
    pub lift: f64,
    pub glow: f64,
    /// Leading edge of the sung fill, in percent of the syllable's width.
    pub gradient: f64,
}

/// Simple lyrics: no scale or glow, a wider soft edge starting further back,
/// and a small steady rise across each word.
pub fn simple_goal(start: f64, end: f64, time: f64) -> Goal {
    let span = if end - start == 0.0 { 1.0 } else { end - start };
    let at = if time < start {
        0.0
    } else if time >= end {
        1.0
    } else {
        (time - start) / span
    };
    Goal {
        scale: 1.0,
        lift: 0.01 - 0.043 * at,
        glow: 0.0,
        gradient: if time < start {
            -50.0
        } else if time >= end {
            100.0
        } else {
            -50.0 + 120.0 * at
        },
    }
}

impl Motion {
    /// Mirrors the fork's rebuildAnimatorTuning: Legacy keeps upstream's
    /// literal curves; other presets put their idle and peak scales into the
    /// curves and multiply lift, glow and blur.
    pub fn tune(&mut self, tuning: Tuning) {
        let idle = tuning.idle_scale;
        self.idle_scale = idle;
        self.scale = Spline::new(&[(0.0, idle), (0.7, tuning.word_peak_scale), (1.0, 1.0)]);
        self.letter_scale = Spline::new(&[(0.0, 1.0), (0.7, tuning.letter_peak_scale), (1.0, 1.0)]);
        let lift = if tuning.legacy {
            1.0
        } else {
            tuning.vertical_strength
        };
        let glow = if tuning.legacy {
            1.0
        } else {
            tuning.glow_strength
        };
        // Strength scales the rise only; unsung text keeps the 0.01em rest
        // inactive lines share in CSS.
        self.lift = Spline::new(&[(0.0, 1.0 / 100.0), (0.9, -lift / 60.0), (1.0, 0.0)]);
        self.glow = Spline::new(&[(0.0, 0.0), (0.15, glow), (0.6, glow), (1.0, 0.0)]);
        self.scale_spring = (tuning.scale_frequency, tuning.scale_damping);
        self.lift_spring = (tuning.vertical_frequency, tuning.vertical_damping);
        self.glow_spring = (tuning.glow_frequency, tuning.glow_damping);
        self.blur_per_line = 1.25 * tuning.blur_strength;
        self.max_blur = self.blur_per_line * 5.465;
    }

    pub fn word_goal(&self, start: f64, end: f64, time: f64) -> Goal {
        let state = sung(start, end, time);
        let at = match state {
            Sung::Unsung => 0.0,
            Sung::Sung => 1.0,
            Sung::Active => progress(start, end, time),
        };
        Goal {
            scale: self.scale.at(at),
            lift: self.lift.at(at),
            glow: self.glow.at(at),
            gradient: match state {
                Sung::Unsung => -20.0,
                Sung::Sung => 100.0,
                Sung::Active => -20.0 + 120.0 * at,
            },
        }
    }

    /// Letters of a held word share its time evenly; the sung letter pops and
    /// its neighbours follow with a steep falloff. Letters lift twice as far.
    pub fn letter_goals(&self, start: f64, end: f64, time: f64, count: usize) -> Vec<Goal> {
        let slot = (end - start) / count.max(1) as f64;
        let rest = |at: f64, gradient: f64| Goal {
            scale: self.letter_scale.at(at),
            lift: self.letter_lift.at(at) * 2.0,
            glow: self.glow.at(at),
            gradient,
        };
        let word = sung(start, end, time);
        if word != Sung::Active {
            return (0..count)
                .map(|_| {
                    if word == Sung::Sung {
                        rest(1.0, 100.0)
                    } else {
                        rest(0.0, -20.0)
                    }
                })
                .collect();
        }
        let (mut active, mut at) = (None, 0.0);
        for index in 0..count {
            let from = start + index as f64 * slot;
            if sung(from, from + slot, time) == Sung::Active {
                active = Some(index);
                at = progress(from, from + slot, time);
                break;
            }
        }
        (0..count)
            .map(|index| {
                let from = start + index as f64 * slot;
                let state = sung(from, from + slot, time);
                let mut goal = rest(0.0, -20.0);
                if state == Sung::Unsung {
                    return goal;
                }
                if let Some(active) = active {
                    let distance = index.abs_diff(active) as f64;
                    let falloff = 1.0 / (1.0 + distance.powf(2.8));
                    let glow_falloff = 1.0 / (1.0 + distance * 0.9);
                    goal.scale += (self.letter_scale.at(at) - goal.scale) * falloff;
                    goal.lift += (self.letter_lift.at(at) * 2.0 - goal.lift) * falloff;
                    goal.glow += (self.glow.at(at) - goal.glow) * glow_falloff;
                } else if state == Sung::Sung {
                    goal.glow = self.glow.at(self.sung_letter_glow);
                }
                goal.gradient = if state == Sung::Sung {
                    100.0
                } else if Some(index) == active {
                    -20.0 + 120.0 * (at * FRAC_PI_2).sin()
                } else {
                    -20.0
                };
                goal
            })
            .collect()
    }

    pub fn springs(&self, scale: f64, lift: f64) -> SyllableSprings {
        SyllableSprings {
            scale: Spring::new(scale, self.scale_spring.0, self.scale_spring.1),
            lift: Spring::new(lift, self.lift_spring.0, self.lift_spring.1),
            glow: Spring::new(0.0, self.glow_spring.0, self.glow_spring.1),
        }
    }

    pub fn line_blur(&self, distance: f64) -> f64 {
        (self.blur_per_line * distance).min(self.max_blur)
    }
}

#[derive(Clone, Copy, Debug)]
pub struct SyllableSprings {
    pub scale: Spring,
    pub lift: Spring,
    pub glow: Spring,
}

#[derive(Clone, Copy, Debug)]
pub struct Pose {
    pub scale: f64,
    pub lift: f64,
    pub glow: f64,
}

impl SyllableSprings {
    pub fn step(&mut self, goal: Goal, seconds: f64) -> Pose {
        self.scale.goal = goal.scale;
        self.lift.goal = goal.lift;
        self.glow.goal = goal.glow;
        Pose {
            scale: self.scale.step(seconds),
            lift: self.lift.step(seconds),
            glow: self.glow.step(seconds),
        }
    }

    /// A sung held word's letters glide back to rest instead of dipping
    /// below it and bouncing as the line moves on.
    pub fn settle(&mut self) {
        self.scale.damping = self.scale.damping.max(1.0);
        self.lift.damping = self.lift.damping.max(1.0);
    }

    pub fn asleep(&self) -> bool {
        self.scale.asleep() && self.lift.asleep() && self.glow.asleep()
    }
}

/// Same set as JavaScript's `\s` with the `u` flag.
pub fn js_space(c: char) -> bool {
    c.is_whitespace() || c == '\u{FEFF}'
}

/// Held syllables animate letter by letter.
pub fn is_emphasis(start: f64, end: f64, text: &str, estimated: bool) -> bool {
    !estimated
        && end - start >= 1000.0
        && text.chars().count() <= 32
        && !text
            .chars()
            .any(|c| js_space(c) || ('\u{0590}'..='\u{08FF}').contains(&c))
}

/// Sizes of runs of syllables that share one layout box: a syllable joins
/// the previous one unless either side of the join has whitespace.
pub fn word_group_sizes<'a>(texts: impl IntoIterator<Item = &'a str>) -> Vec<usize> {
    let mut sizes: Vec<usize> = Vec::new();
    let mut previous_ends_spaced = true;
    for text in texts {
        let joins = !sizes.is_empty()
            && !text.chars().next().is_some_and(js_space)
            && !previous_ends_spaced;
        if joins {
            *sizes.last_mut().unwrap_or(&mut 0) += 1;
        } else {
            sizes.push(1);
        }
        previous_ends_spaced = text.chars().last().is_some_and(js_space);
    }
    sizes
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Dot {
    pub opacity: f64,
    pub scale: f64,
    pub glow: f64,
    pub lift: f64,
}

pub struct DotCurves {
    scale: Spline,
    lift: Spline,
    opacity: Spline,
}

impl Default for DotCurves {
    fn default() -> Self {
        Self {
            scale: Spline::new(&[(0.0, 1.0), (0.7, 1.4), (1.0, 4.0 / 3.0)]),
            lift: Spline::new(&[(0.0, 0.0), (0.9, 0.12), (1.0, 0.0)]),
            opacity: Spline::new(&[(0.0, DORMANT_DOT_OPACITY), (0.6, 1.0), (1.0, 1.0)]),
        }
    }
}

pub fn countdown_visible(gap_start: f64, gap_end: f64, time: f64) -> bool {
    time >= gap_start && time < gap_end - 500.0
}

impl DotCurves {
    /// Where each dot is heading: it swells, traces a smooth arc and settles
    /// slightly smaller, all on song time.
    pub fn dots(&self, gap_start: f64, gap_end: f64, time: f64, reduce_motion: bool) -> [Dot; 3] {
        let progress = (time - gap_start) / (gap_end - gap_start - COUNTDOWN_TAIL_MS).max(1.0);
        std::array::from_fn(|index| {
            let phase = (progress * 3.0 - index as f64).clamp(0.0, 1.0);
            let opacity = self.opacity.at(phase).min(1.0);
            Dot {
                opacity,
                scale: self.scale.at(phase),
                glow: (opacity - DORMANT_DOT_OPACITY) / (1.0 - DORMANT_DOT_OPACITY),
                lift: if reduce_motion {
                    0.0
                } else {
                    self.lift.at(phase)
                },
            }
        })
    }
}

/// Frequency and damping per dot property; the lift is underdamped so a
/// finished dot lands with a slight bounce.
const DOT_SPRINGS: [(f64, f64); 4] = [(1.0, 0.5), (0.7, 0.6), (1.0, 0.5), (1.25, 0.4)];

/// Eases countdown dots toward their targets. Jumps in song time and reduced
/// motion snap straight to the target.
#[derive(Default)]
pub struct CountdownSprings {
    dots: Option<Vec<[Spring; 4]>>,
    last: Option<(f64, f64)>,
}

impl CountdownSprings {
    pub fn frame(&mut self, targets: &[Dot], time: f64, now: f64, snap: bool) -> Vec<Dot> {
        let elapsed = self.last.map_or(0.0, |(_, at)| (now - at) / 1000.0);
        let jumped = match self.last {
            None => true,
            Some((last, _)) => (time - last - elapsed * 1000.0).abs() > 750.0 || time < last - 50.0,
        };
        self.last = Some((time, now));
        let settle = snap || jumped || self.dots.is_none();
        let dots = self.dots.get_or_insert_with(|| {
            targets
                .iter()
                .map(|target| {
                    let values = [target.opacity, target.scale, target.glow, target.lift];
                    std::array::from_fn(|key| {
                        Spring::new(values[key], DOT_SPRINGS[key].0, DOT_SPRINGS[key].1)
                    })
                })
                .collect()
        });
        let seconds = elapsed.clamp(0.0, 0.1);
        targets
            .iter()
            .enumerate()
            .map(|(index, target)| {
                let goals = [target.opacity, target.scale, target.glow, target.lift];
                let Some(springs) = dots.get_mut(index) else {
                    return *target;
                };
                let mut values = [0.0; 4];
                for key in 0..4 {
                    let spring = &mut springs[key];
                    spring.goal = goals[key];
                    if settle {
                        spring.position = goals[key];
                        spring.velocity = 0.0;
                    } else {
                        spring.step(seconds);
                    }
                    values[key] = spring.position;
                }
                Dot {
                    opacity: values[0],
                    scale: values[1],
                    glow: values[2],
                    lift: values[3],
                }
            })
            .collect()
    }
}
