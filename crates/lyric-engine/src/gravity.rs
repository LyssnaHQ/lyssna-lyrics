//! Space Gravity physics: words drift as bodies in zero gravity.
//!
//! Ported from the pixels-spicy-lyrics fork's Space Gravity mode
//! (src/utils/Lyrics/SpaceGravity.ts, 100.10.54, AGPL-3.0) by way of the app's
//! earlier TypeScript copy: seeded drift speeds scaled by the line's words per
//! minute, seeded bounces off the play area and obstacles, soft separation
//! between words, a gentle upward pull in the lower half, rotation with
//! damping, a kick opposite to the window's own movement, spawning near each
//! word's place in the line with a spiral search, and a static layout under
//! reduced motion.

use std::f64::consts::PI;

pub const EDGE_PADDING: f64 = 18.0;
pub const OBSTACLE_CLEARANCE: f64 = 12.0;
pub const WORD_OVERHANG: f64 = 0.3;
pub const MAX_SPEED: f64 = 16.0;
pub const WPM_THRESHOLD: f64 = 60.0;
pub const WPM_MAX: f64 = 180.0;
pub const MAX_WPM_MULTIPLIER: f64 = 1.75;
pub const HIGH_SPEED_DRAG: f64 = 0.6;
pub const WINDOW_SMOOTHING: f64 = 0.18;
pub const WINDOW_IMPULSE: f64 = 1.1;
pub const RESTITUTION: f64 = 0.82;
pub const MAX_RESTITUTION: f64 = 2.4;
pub const SEPARATION_GAP: f64 = 10.0;
pub const SEPARATION_ACCELERATION: f64 = 5.0;
pub const UPWARD_ACCELERATION: f64 = 0.4;
pub const SPIN_DAMPING: f64 = 0.18;
pub const MIN_VISIBLE_WORDS: f64 = 12.0;
pub const MAX_VISIBLE_WORDS: f64 = 120.0;
pub const AREA_PER_WORD: f64 = 33_334.0;
pub const SPAWN_ATTEMPTS: usize = 48;
pub const SPAWN_CLEARANCE: f64 = 4.0;
pub const MAX_STEP: f64 = 0.05;

/// JavaScript's ToUint32: the number modulo 2^32.
fn uint32(value: f64) -> u32 {
    if !value.is_finite() {
        return 0;
    }
    value.trunc().rem_euclid(4_294_967_296.0) as u32
}

/// FNV-1a over UTF-16 code units, as the web view hashed strings.
pub fn hash(value: &str) -> u32 {
    let mut result: u32 = 2_166_136_261;
    for unit in value.encode_utf16() {
        result ^= unit as u32;
        result = result.wrapping_mul(16_777_619);
    }
    result
}

/// Deterministic random number in [0, 1) from a seed (mulberry32).
pub fn random(seed: f64) -> f64 {
    let mut value = uint32(seed + 0x6d2b79f5 as f64);
    value = (value ^ (value >> 15)).wrapping_mul(value | 1);
    value ^= value.wrapping_add((value ^ (value >> 7)).wrapping_mul(value | 61));
    (value ^ (value >> 14)) as f64 / 4_294_967_296.0
}

/// Formats a number as JavaScript's `String(number)` does for the values
/// hashed here: integers without a decimal point.
fn js_number(value: f64) -> String {
    if value.fract() == 0.0 && value.abs() < 1e21 {
        format!("{}", value as i64)
    } else {
        format!("{value}")
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Rect {
    pub left: f64,
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
}

#[derive(Clone, Debug, Default)]
pub struct Field {
    pub width: f64,
    pub height: f64,
    pub area: Option<Rect>,
    pub layout: Option<Rect>,
    pub cover: Option<Rect>,
    pub blockers: Vec<Rect>,
    pub footer: Option<Rect>,
}

impl Field {
    fn play_area(&self) -> Rect {
        self.area.unwrap_or(Rect {
            left: 0.0,
            top: 0.0,
            right: self.width,
            bottom: self.height,
        })
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Body {
    pub seed: f64,
    pub line_start: f64,
    pub order: f64,
    pub x: f64,
    pub y: f64,
    pub vx: f64,
    pub vy: f64,
    pub angle: f64,
    pub spin: f64,
    pub bounces: f64,
    pub speed: f64,
    pub width: f64,
    pub height: f64,
    pub base_radius: f64,
    pub radius: f64,
    pub scale: f64,
    pub natural_x: f64,
    pub natural_y: f64,
}

/// Numbers per body when bodies cross to and from the web view.
pub const BODY_VALUES: usize = 18;

impl Body {
    pub fn to_values(&self) -> [f64; BODY_VALUES] {
        [
            self.seed,
            self.line_start,
            self.order,
            self.x,
            self.y,
            self.vx,
            self.vy,
            self.angle,
            self.spin,
            self.bounces,
            self.speed,
            self.width,
            self.height,
            self.base_radius,
            self.radius,
            self.scale,
            self.natural_x,
            self.natural_y,
        ]
    }

    pub fn from_values(values: &[f64]) -> Self {
        let value = |index: usize| values.get(index).copied().unwrap_or(0.0);
        Self {
            seed: value(0),
            line_start: value(1),
            order: value(2),
            x: value(3),
            y: value(4),
            vx: value(5),
            vy: value(6),
            angle: value(7),
            spin: value(8),
            bounces: value(9),
            speed: value(10),
            width: value(11),
            height: value(12),
            base_radius: value(13),
            radius: value(14),
            scale: value(15),
            natural_x: value(16),
            natural_y: value(17),
        }
    }
}

/// Faster lines drift faster: 1x up to 60 wpm, 1.75x from 180 wpm.
pub fn speed_multiplier(word_starts: &[f64]) -> f64 {
    let mut starts = word_starts.to_vec();
    starts.sort_by(f64::total_cmp);
    starts.dedup();
    if starts.len() < 2 {
        return 1.0;
    }
    let duration = starts[starts.len() - 1] - starts[0];
    let wpm = if duration > 0.0 {
        (starts.len() - 1) as f64 * 60_000.0 / duration
    } else {
        0.0
    };
    if wpm <= WPM_THRESHOLD {
        return 1.0;
    }
    let progress = ((wpm - WPM_THRESHOLD) / (WPM_MAX - WPM_THRESHOLD)).min(1.0);
    1.0 + progress * (MAX_WPM_MULTIPLIER - 1.0)
}

pub fn create_body(seed: f64, speed: f64, line_start: f64, order: f64) -> Body {
    let velocity = (4.4 + random(seed + 3.0) * 5.6) * speed;
    let direction = random(seed + 4.0) * PI * 2.0;
    Body {
        seed,
        line_start,
        order,
        vx: direction.cos() * velocity,
        vy: direction.sin() * velocity,
        spin: (random(seed + 2.0) * 2.0 - 1.0) * 19.0,
        speed,
        width: 48.0,
        height: 48.0,
        base_radius: 24.0,
        radius: 24.0,
        scale: 1.0,
        ..Default::default()
    }
}

/// Collision circle for a word box, with room for glyph overhang.
pub fn measure(body: &mut Body, width: f64, height: f64) {
    body.width = width;
    body.height = height;
    body.base_radius = (width.hypot(height) / 2.0 + height * WORD_OVERHANG).max(14.0);
    body.radius = body.base_radius * body.scale;
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Axis {
    X,
    Y,
}

#[derive(Default)]
struct Hit {
    x: bool,
    y: bool,
}

impl Hit {
    fn has(&self, axis: Axis) -> bool {
        match axis {
            Axis::X => self.x,
            Axis::Y => self.y,
        }
    }

    fn add(&mut self, axis: Axis) {
        match axis {
            Axis::X => self.x = true,
            Axis::Y => self.y = true,
        }
    }
}

fn bounce(body: &mut Body, axis: Axis, direction: f64, hit: &mut Hit) {
    let velocity = match axis {
        Axis::X => body.vx,
        Axis::Y => body.vy,
    };
    let set = |body: &mut Body, value: f64| match axis {
        Axis::X => body.vx = value,
        Axis::Y => body.vy = value,
    };
    if !velocity.is_finite() {
        return set(body, 0.0);
    }
    if velocity * direction >= 0.0 {
        return;
    }
    // Hitting opposite walls in one solve would amplify forever; stop instead.
    if hit.has(axis) {
        return set(body, 0.0);
    }
    hit.add(axis);
    let key = format!(
        "{}:{}:{}",
        js_number(body.line_start),
        js_number(body.order),
        js_number(body.bounces)
    );
    body.bounces += 1.0;
    // Most bounces keep their speed; rare ones launch hard.
    let strength =
        RESTITUTION + random(hash(&key) as f64).powi(2) * (MAX_RESTITUTION - RESTITUTION);
    let capped = (MAX_SPEED * MAX_RESTITUTION * body.speed).min(velocity.abs() * strength);
    set(body, direction * capped);
}

fn limits(body: &Body, field: &Field, padding: f64) -> Rect {
    let area = field.play_area();
    let pad_x = padding.min(((area.right - area.left) / 2.0 - body.radius).max(0.0));
    let pad_y = padding.min(((area.bottom - area.top) / 2.0 - body.radius).max(0.0));
    Rect {
        left: area.left + pad_x + body.radius,
        right: area.right - pad_x - body.radius,
        top: area.top + pad_y + body.radius,
        bottom: area.bottom - pad_y - body.radius,
    }
}

fn clamp_to_area(body: &mut Body, field: &Field, hit: &mut Hit, padding: f64) -> bool {
    let limit = limits(body, field, padding);
    let mut changed = false;
    if body.x < limit.left {
        body.x = limit.left;
        bounce(body, Axis::X, 1.0, hit);
        changed = true;
    } else if body.x > limit.right {
        body.x = limit.right;
        bounce(body, Axis::X, -1.0, hit);
        changed = true;
    }
    if body.y < limit.top {
        body.y = limit.top;
        bounce(body, Axis::Y, 1.0, hit);
        changed = true;
    } else if body.y > limit.bottom {
        body.y = limit.bottom;
        bounce(body, Axis::Y, -1.0, hit);
        changed = true;
    }
    changed
}

pub fn intersects(body: &Body, rect: Option<&Rect>) -> bool {
    let Some(rect) = rect else { return false };
    let nearest_x = body.x.max(rect.left).min(rect.right);
    let nearest_y = body.y.max(rect.top).min(rect.bottom);
    (body.x - nearest_x).hypot(body.y - nearest_y) < body.radius
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Exit {
    Left,
    Right,
    Top,
    Bottom,
}

const ALL_EXITS: [Exit; 4] = [Exit::Left, Exit::Right, Exit::Top, Exit::Bottom];
const FOOTER_EXITS: [Exit; 3] = [Exit::Left, Exit::Right, Exit::Top];

/// Pushes a body out through the nearest allowed side of an obstacle.
fn push_out(
    body: &mut Body,
    rect: Option<&Rect>,
    field: &Field,
    exits: &[Exit],
    hit: &mut Hit,
    padding: f64,
) -> bool {
    let Some(rect) = rect else { return false };
    if !intersects(body, Some(rect)) {
        return false;
    }
    let limit = limits(body, field, padding);
    let candidates = [
        (Exit::Left, rect.left - body.radius, body.y),
        (Exit::Right, rect.right + body.radius, body.y),
        (Exit::Top, body.x, rect.top - body.radius),
        (Exit::Bottom, body.x, rect.bottom + body.radius),
    ];
    let mut best: Option<(Exit, f64, f64)> = None;
    for candidate in candidates {
        let (side, x, y) = candidate;
        if !exits.contains(&side)
            || x < limit.left
            || x > limit.right
            || y < limit.top
            || y > limit.bottom
        {
            continue;
        }
        best = match best {
            Some(current)
                if (x - body.x).hypot(y - body.y)
                    >= (current.1 - body.x).hypot(current.2 - body.y) =>
            {
                Some(current)
            }
            _ => Some(candidate),
        };
    }
    let Some((side, x, y)) = best else {
        return false;
    };
    body.x = x;
    body.y = y;
    match side {
        Exit::Left => bounce(body, Axis::X, -1.0, hit),
        Exit::Right => bounce(body, Axis::X, 1.0, hit),
        Exit::Top => bounce(body, Axis::Y, -1.0, hit),
        Exit::Bottom => bounce(body, Axis::Y, 1.0, hit),
    }
    true
}

fn set_scale(body: &mut Body, scale: f64) {
    body.scale = scale;
    body.radius = body.base_radius * scale;
}

/// Shrinks words to fit the largest free strip beside the artwork.
fn fit_around_cover(body: &mut Body, field: &Field) {
    let area = field.play_area();
    let width = area.right - area.left;
    let height = area.bottom - area.top;
    let cover = match field.cover {
        Some(cover)
            if !(cover.right <= area.left
                || cover.left >= area.right
                || cover.bottom <= area.top
                || cover.top >= area.bottom) =>
        {
            cover
        }
        _ => {
            let scale = 1f64
                .min(width / (2.0 * body.base_radius))
                .min(height / (2.0 * body.base_radius));
            set_scale(body, scale);
            return;
        }
    };
    let spans = [
        (area.right.min(cover.left) - area.left).max(0.0),
        (area.right - area.left.max(cover.right)).max(0.0),
        (area.bottom.min(cover.top) - area.top).max(0.0),
        (area.bottom - area.top.max(cover.bottom)).max(0.0),
    ];
    let room = (spans[0] / 2.0)
        .min(height / 2.0)
        .max((spans[1] / 2.0).min(height / 2.0))
        .max((spans[2] / 2.0).min(width / 2.0))
        .max((spans[3] / 2.0).min(width / 2.0));
    set_scale(body, 1f64.min(room / body.base_radius));
}

fn expand(rect: Option<Rect>, amount: f64) -> Option<Rect> {
    rect.map(|rect| Rect {
        left: rect.left - amount,
        top: rect.top - amount,
        right: rect.right + amount,
        bottom: rect.bottom + amount,
    })
}

/// Keeps a body inside the play area, beside the artwork and blockers and
/// above the footer. Tight layouts drop the margins before giving up.
pub fn constrain(body: &mut Body, field: &Field) {
    fit_around_cover(body, field);
    let hard: Vec<Option<Rect>> = std::iter::once(field.cover)
        .chain(field.blockers.iter().copied().map(Some))
        .collect();
    let padded: Vec<Option<Rect>> = hard
        .iter()
        .map(|rect| expand(*rect, OBSTACLE_CLEARANCE))
        .collect();
    let mut hit = Hit::default();
    let solve = |body: &mut Body, hit: &mut Hit, rects: &[Option<Rect>], padding: f64| {
        let mut changed = clamp_to_area(body, field, hit, padding);
        for rect in rects {
            changed = push_out(body, rect.as_ref(), field, &ALL_EXITS, hit, padding) || changed;
        }
        push_out(
            body,
            field.footer.as_ref(),
            field,
            &FOOTER_EXITS,
            hit,
            EDGE_PADDING,
        ) || changed
    };
    for _ in 0..4 {
        if !solve(body, &mut hit, &padded, EDGE_PADDING) {
            return;
        }
    }
    if !hard.iter().any(|rect| intersects(body, rect.as_ref())) {
        clamp_to_area(body, field, &mut hit, EDGE_PADDING);
        return;
    }
    for _ in 0..4 {
        if !solve(body, &mut hit, &hard, 0.0) {
            break;
        }
    }
    clamp_to_area(body, field, &mut hit, 0.0);
}

/// Restores a body whose motion became NaN or infinite.
fn recover(body: &mut Body) {
    let position = body.x.is_finite() && body.y.is_finite();
    let velocity = body.vx.is_finite() && body.vy.is_finite();
    let rotation = body.angle.is_finite() && body.spin.is_finite();
    if position && velocity && rotation {
        return;
    }
    let seed = hash(&format!(
        "{}:{}:{}:recovery",
        js_number(body.line_start),
        js_number(body.order),
        js_number(body.bounces)
    )) as f64;
    let speed = (4.4 + random(seed) * 5.6) * body.speed;
    let direction = random(seed + 1.0) * PI * 2.0;
    if !position {
        body.x = if body.natural_x.is_finite() {
            body.natural_x
        } else {
            0.0
        };
        body.y = if body.natural_y.is_finite() {
            body.natural_y
        } else {
            0.0
        };
    }
    if !velocity {
        body.vx = direction.cos() * speed;
        body.vy = direction.sin() * speed;
    }
    if !rotation {
        body.angle = 0.0;
        body.spin = (random(seed + 2.0) * 2.0 - 1.0) * 19.0;
    }
}

/// Smoothed window velocity in CSS pixels per second. `None` position means
/// the window has not been sampled yet.
#[derive(Clone, Copy, Debug, Default)]
pub struct WindowMotion {
    pub position: Option<(f64, f64)>,
    pub vx: f64,
    pub vy: f64,
}

pub fn track_window(motion: &mut WindowMotion, position: Option<(f64, f64)>, dt: f64) {
    let Some((x, y)) = position else { return };
    if let Some((last_x, last_y)) = motion.position {
        let time = dt.max(0.001);
        motion.vx += ((x - last_x) / time - motion.vx) * WINDOW_SMOOTHING;
        motion.vy += ((y - last_y) / time - motion.vy) * WINDOW_SMOOTHING;
    }
    motion.position = Some((x, y));
}

/// Advances shown words by `dt` seconds in small substeps. Words fading out
/// still feel window throws but otherwise stay where they are.
pub fn step(bodies: &mut [Body], dt: f64, field: &Field, window: (f64, f64), exiting: &mut [Body]) {
    for body in bodies.iter_mut() {
        recover(body);
    }
    let (window_vx, window_vy) = window;
    let mut remaining = dt.clamp(0.0, 0.1);
    while remaining > 0.0 {
        let delta = MAX_STEP.min(remaining);
        remaining -= delta;
        if window_vx != 0.0 || window_vy != 0.0 {
            for body in bodies.iter_mut().chain(exiting.iter_mut()) {
                // Moving the window throws the words the other way.
                body.vx -= window_vx * WINDOW_IMPULSE * delta;
                body.vy -= window_vy * WINDOW_IMPULSE * delta;
            }
        }
        for index in 0..bodies.len() {
            for other in 0..index {
                let (a, b) = (bodies[index], bodies[other]);
                let (mut dx, mut dy) = (a.x - b.x, a.y - b.y);
                let mut distance = dx.hypot(dy);
                if distance < 0.001 {
                    let key = format!(
                        "{}:{}:{}:{}:avoidance",
                        js_number(a.line_start),
                        js_number(a.order),
                        js_number(b.line_start),
                        js_number(b.order)
                    );
                    let angle = random(hash(&key) as f64) * PI * 2.0;
                    dx = angle.cos() * 0.001;
                    dy = angle.sin() * 0.001;
                    distance = 0.001;
                }
                let reach = a.radius + b.radius + SEPARATION_GAP;
                if distance >= reach {
                    continue;
                }
                let nudge = (reach - distance) / reach * SEPARATION_ACCELERATION * delta;
                bodies[index].vx += dx / distance * nudge;
                bodies[index].vy += dy / distance * nudge;
                bodies[other].vx -= dx / distance * nudge;
                bodies[other].vy -= dy / distance * nudge;
            }
        }
        for body in bodies.iter_mut() {
            let speed = body.vx.hypot(body.vy);
            let limit = MAX_SPEED * body.speed;
            if speed > limit {
                let next = limit + (speed - limit) * (-HIGH_SPEED_DRAG * delta).exp();
                body.vx = body.vx / speed * next;
                body.vy = body.vy / speed * next;
            }
            body.vy -=
                UPWARD_ACCELERATION * ((body.y / field.height - 0.45) / 0.55).max(0.0) * delta;
            body.x += body.vx * delta;
            body.y += body.vy * delta;
            body.spin *= (-SPIN_DAMPING * delta).exp();
            body.angle = ((body.angle + body.spin * delta + 180.0) % 360.0 + 360.0) % 360.0 - 180.0;
            constrain(body, field);
        }
    }
}

/// How deep two rotated word boxes overlap, by separating axes.
pub fn spawn_overlap(body: &Body, other: &Body) -> f64 {
    let a = body.angle * PI / 180.0;
    let b = other.angle * PI / 180.0;
    let (a_cos, a_sin, b_cos, b_sin) = (a.cos(), a.sin(), b.cos(), b.sin());
    let clearance = SPAWN_CLEARANCE / 2.0;
    let aw = body.width * body.scale / 2.0 + clearance;
    let ah = body.height * body.scale / 2.0 + clearance;
    let bw = other.width * other.scale / 2.0 + clearance;
    let bh = other.height * other.scale / 2.0 + clearance;
    let (dx, dy) = (body.x - other.x, body.y - other.y);
    let mut least = f64::INFINITY;
    for (x, y) in [
        (a_cos, a_sin),
        (-a_sin, a_cos),
        (b_cos, b_sin),
        (-b_sin, b_cos),
    ] {
        let reach_a = aw * (a_cos * x + a_sin * y).abs() + ah * (-a_sin * x + a_cos * y).abs();
        let reach_b = bw * (b_cos * x + b_sin * y).abs() + bh * (-b_sin * x + b_cos * y).abs();
        let overlap = reach_a + reach_b - (dx * x + dy * y).abs();
        if overlap <= 0.0 {
            return 0.0;
        }
        least = least.min(overlap);
    }
    least
}

/// Places a new word near its spot in the line, searching a golden-angle
/// spiral outward for room among words already on screen. `rolls` are three
/// uniform randoms: the start offset across and down, and the spiral phase.
pub fn spawn(body: &mut Body, occupied: &[Body], field: &Field, reduced: bool, rolls: [f64; 3]) {
    // Beside artwork, words start in the lyrics column; they may drift
    // around the artwork later but never appear there.
    let mut field = field.clone();
    if field.cover.is_some() && field.layout.is_some() {
        field.area = field.layout;
    }
    let start_x = body.natural_x + (rolls[0] * 2.0 - 1.0) * body.width * 1.35;
    let start_y = body.natural_y + (rolls[1] * 2.0 - 1.0) * body.height * 1.35;
    let phase = rolls[2] * PI * 2.0;
    let area = field.play_area();
    let reach = (area.right - area.left).hypot(area.bottom - area.top);
    let mut best = Body {
        x: start_x,
        y: start_y,
        angle: 0.0,
        ..*body
    };
    let mut best_overlap = f64::INFINITY;
    let attempts = if reduced { 1 } else { SPAWN_ATTEMPTS };
    for attempt in 0..attempts {
        let distance = reach * attempt as f64 / (SPAWN_ATTEMPTS - 1) as f64;
        let angle = phase + attempt as f64 * PI * (3.0 - 5f64.sqrt());
        let mut candidate = Body {
            x: start_x + angle.cos() * distance,
            y: start_y + angle.sin() * distance,
            angle: 0.0,
            ..*body
        };
        constrain(&mut candidate, &field);
        let overlap: f64 = occupied
            .iter()
            .map(|other| spawn_overlap(&candidate, other).powi(2))
            .sum();
        if overlap < best_overlap {
            best = candidate;
            best_overlap = overlap;
        }
        if overlap == 0.0 {
            break;
        }
    }
    *body = best;
}

/// Reduced motion: shown lines sit centred and still, one row each.
pub fn static_layout(lines: &mut [Vec<Body>], field: &Field) {
    let heights: Vec<f64> = lines
        .iter()
        .map(|line| {
            line.iter()
                .map(|body| body.height)
                .fold(f64::NEG_INFINITY, f64::max)
        })
        .collect();
    let total = heights.iter().sum::<f64>() + (lines.len() as f64 - 1.0).max(0.0) * 12.0;
    let mut y = EDGE_PADDING.max((field.height - total) / 2.0);
    for (index, line) in lines.iter_mut().enumerate() {
        let line_width = line.iter().map(|body| body.width).sum::<f64>()
            + (line.len() as f64 - 1.0).max(0.0) * 6.0;
        let mut x = EDGE_PADDING.max((field.width - line_width) / 2.0);
        for body in line.iter_mut() {
            body.x = x + body.width / 2.0;
            body.y = y + heights[index] / 2.0;
            body.angle = 0.0;
            constrain(body, field);
            x += body.width + 6.0;
        }
        y += heights[index] + 12.0;
    }
}

fn overlap_area(rect: Option<Rect>, area: &Rect) -> f64 {
    rect.map_or(0.0, |rect| {
        (area.right.min(rect.right) - area.left.max(rect.left)).max(0.0)
            * (area.bottom.min(rect.bottom) - area.top.max(rect.top)).max(0.0)
    })
}

/// How many lead words fit the play area left free by artwork and credits.
pub fn visible_word_count(field: &Field) -> f64 {
    let area = field.play_area();
    let free = ((area.right - area.left) * (area.bottom - area.top)
        - overlap_area(field.cover, &area)
        - overlap_area(field.footer, &area))
    .max(0.0);
    MAX_VISIBLE_WORDS.min(MIN_VISIBLE_WORDS.max((free / AREA_PER_WORD).ceil()))
}

/// The run of `count` words centred on `anchor` within `total`.
pub fn word_window(anchor: f64, total: f64, count: f64) -> Option<(f64, f64)> {
    if total == 0.0 || !anchor.is_finite() {
        return None;
    }
    let size = count.min(total);
    let first = (anchor - ((size - 1.0) / 2.0).floor())
        .min(total - size)
        .max(0.0);
    Some((first, first + size - 1.0))
}

/// Each word's place when its line is laid out in the play area: rows wrap
/// at the area's width and duet lines sit at the right. Returns centres
/// relative to the line top, and the line's height.
pub fn line_layout(
    sizes: &[(f64, f64)],
    width: f64,
    opposite: bool,
    gap: f64,
) -> (Vec<(f64, f64)>, f64) {
    struct Row {
        items: Vec<usize>,
        width: f64,
        height: f64,
    }
    let mut rows: Vec<Row> = Vec::new();
    for (index, &(item_width, item_height)) in sizes.iter().enumerate() {
        match rows.last_mut() {
            Some(row) if row.width + gap + item_width <= width => {
                row.items.push(index);
                row.width += gap + item_width;
                row.height = row.height.max(item_height);
            }
            _ => rows.push(Row {
                items: vec![index],
                width: item_width,
                height: item_height,
            }),
        }
    }
    let mut places = vec![(0.0, 0.0); sizes.len()];
    let mut top = 0.0;
    for (number, row) in rows.iter().enumerate() {
        if number > 0 {
            top += gap;
        }
        let mut x = if opposite {
            (width - row.width).max(0.0)
        } else if gap != 0.0 {
            ((width - row.width) / 2.0).max(0.0)
        } else {
            0.0
        };
        for &index in &row.items {
            places[index] = (x + sizes[index].0 / 2.0, top + sizes[index].1 / 2.0);
            x += sizes[index].0 + gap;
        }
        top += row.height;
    }
    (places, top)
}

const DASHES: [char; 7] = [
    '-', '\u{2010}', '\u{2011}', '\u{2012}', '\u{2013}', '\u{2014}', '\u{2015}',
];

fn is_dash(c: char) -> bool {
    DASHES.contains(&c)
}

/// Splits text into hyphen-joined parts, each keeping its trailing dashes:
/// "eye-eye-eyes" gives "eye-", "eye-", "eyes".
pub fn dash_parts(text: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut in_dashes = false;
    for c in text.chars() {
        if is_dash(c) {
            if current.is_empty() {
                // A leading dash matches no part, as the web view's pattern.
                continue;
            }
            in_dashes = true;
            current.push(c);
        } else {
            if in_dashes {
                parts.push(std::mem::take(&mut current));
                in_dashes = false;
            }
            current.push(c);
        }
    }
    if !current.is_empty() {
        parts.push(current);
    }
    if parts.is_empty() {
        parts.push(text.to_owned());
    }
    parts
}

#[derive(Clone, Debug, PartialEq)]
pub struct WordInput {
    pub text: String,
    pub start: f64,
    pub end: f64,
    pub estimated: bool,
}

/// One floating piece. A piece either groups `count` source words from
/// `first`, or (when `split`) is one hyphen part of the word at `first`.
#[derive(Clone, Debug, PartialEq)]
pub struct Piece {
    pub text: String,
    pub start: f64,
    pub end: f64,
    pub first: usize,
    pub count: usize,
    pub split: bool,
    pub word_start: f64,
    pub word_end: f64,
    /// For a held word split into parts: where this part's letters start
    /// and how many letters the whole word has. Negative when not held.
    pub letter_offset: f64,
    pub letter_count: f64,
}

fn trim_js(text: &str) -> &str {
    text.trim_matches(|c: char| c.is_whitespace() || c == '\u{FEFF}')
}

/// JavaScript's Math.round: halves round up.
fn js_round(value: f64) -> f64 {
    (value + 0.5).floor()
}

/// One floating piece per hyphen-joined part, like Spicy Lyrics. Pieces sung
/// as one timed word share its time by letter count.
pub fn gravity_pieces(group: &[WordInput]) -> Vec<Piece> {
    let mut pieces = Vec::new();
    let mut current: Vec<usize> = Vec::new();
    let flush = |current: &mut Vec<usize>, pieces: &mut Vec<Piece>| {
        if current.is_empty() {
            return;
        }
        let joined: String = current
            .iter()
            .map(|&index| group[index].text.as_str())
            .collect();
        let text = trim_js(&joined).to_owned();
        let first = current[0];
        let start = group[first].start;
        let end = group[*current.last().unwrap_or(&first)].end;
        let parts = dash_parts(&text);
        if current.len() > 1 || parts.len() < 2 {
            if !text.is_empty() {
                pieces.push(Piece {
                    text,
                    start,
                    end,
                    first,
                    count: current.len(),
                    split: false,
                    word_start: start,
                    word_end: end,
                    letter_offset: -1.0,
                    letter_count: -1.0,
                });
            }
        } else {
            let word = &group[first];
            let shown = word
                .text
                .trim_start_matches(|c: char| c.is_whitespace() || c == '\u{FEFF}');
            let held = crate::motion::is_emphasis(word.start, word.end, shown, word.estimated);
            let weights: Vec<f64> = parts
                .iter()
                .map(|part| part.encode_utf16().count().max(1) as f64)
                .collect();
            let total: f64 = weights.iter().sum();
            let mut used = 0.0;
            for (index, part) in parts.iter().enumerate() {
                let from = start + (end - start) * used / total;
                let letter_offset = used;
                used += weights[index];
                let to = if index == parts.len() - 1 {
                    end
                } else {
                    js_round(start + (end - start) * used / total)
                };
                pieces.push(Piece {
                    text: part.clone(),
                    start: js_round(from),
                    end: to,
                    first,
                    count: 1,
                    split: true,
                    word_start: if held { start } else { js_round(from) },
                    word_end: if held { end } else { to },
                    letter_offset: if held { letter_offset } else { -1.0 },
                    letter_count: if held { total } else { -1.0 },
                });
            }
        }
        current.clear();
    };
    for (index, word) in group.iter().enumerate() {
        current.push(index);
        let next = group.get(index + 1);
        if trim_js(&word.text).ends_with(is_dash)
            || next.is_some_and(|next| trim_js(&next.text).starts_with(is_dash))
        {
            flush(&mut current, &mut pieces);
        }
    }
    flush(&mut current, &mut pieces);
    pieces
}
