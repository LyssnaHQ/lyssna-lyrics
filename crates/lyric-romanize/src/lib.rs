//! Lyric romanization as Spicy Lyrics does it (iPixelGalaxy/spicy-lyrics,
//! src/utils/Lyrics/ProcessLyrics.ts): the scripts present across the whole
//! song pick the converters, and each word or line runs through every one
//! whose letters it holds, in a fixed order. A song with kana is Japanese, so
//! its kanji read as Japanese, never as Chinese; Han text without kana is
//! Chinese (pinyin). Korean, Cyrillic and Greek have their own converters.
//! Romanization supplied with the lyrics always wins. Lyssna addition: any
//! other non-Latin letters, such as Arabic or Thai, fall back to a general
//! transliteration.
//!
//! A line arrives as pieces (its timed syllables, or the whole line); each
//! script reads the line as one text so words split over syllables keep their
//! reading, and the readings go back to the syllable each one starts in.

mod hepburn;
pub mod japanese;

use serde::{Deserialize, Serialize};
use unicode_normalization::{UnicodeNormalization, char::is_combining_mark};
use unicode_script::{Script, UnicodeScript};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SongScript {
    Japanese,
    Chinese,
    Korean,
    Cyrillic,
    Greek,
}

pub(crate) fn is_space(c: char) -> bool {
    js_space(c)
}

pub(crate) fn is_han(c: char) -> bool {
    c.script() == Script::Han
}

fn is_song_kana(c: char) -> bool {
    matches!(c, '\u{3041}'..='\u{3096}' | '\u{30A1}'..='\u{30FA}')
}

fn is_song_korean(c: char) -> bool {
    matches!(c,
        '가'..='\u{D7AF}' | '\u{1100}'..='\u{11FF}' | '\u{3130}'..='\u{318F}'
        | '\u{A960}'..='\u{A97F}' | '\u{D7B0}'..='\u{D7FF}')
}

fn is_greek(c: char) -> bool {
    matches!(c, '\u{0370}'..='\u{03FF}' | '\u{1F00}'..='\u{1FFF}')
}

fn is_song_cyrillic(c: char) -> bool {
    matches!(c, '\u{0400}'..='\u{052F}' | '\u{2DE0}'..='\u{2DFF}' | '\u{A640}'..='\u{A69F}')
}

fn is_cyrillic(c: char) -> bool {
    matches!(c, '\u{0400}'..='\u{052F}')
}

fn is_hangul(c: char) -> bool {
    matches!(c, '가'..='힣')
}

/// The scripts present across the song, in conversion order.
pub fn song_scripts<'a>(texts: impl IntoIterator<Item = &'a str>) -> Vec<SongScript> {
    let all: Vec<char> = texts
        .into_iter()
        .flat_map(|text| text.chars().chain(['\n']))
        .collect();
    let mut scripts = Vec::new();
    if all.iter().any(|&c| is_song_kana(c)) {
        scripts.push(SongScript::Japanese);
    } else if all.iter().any(|&c| is_han(c)) {
        scripts.push(SongScript::Chinese);
    }
    if all.iter().any(|&c| is_song_korean(c)) {
        scripts.push(SongScript::Korean);
    }
    // Like the fork, Cyrillic needs two letters in a row across the song, so
    // one look-alike letter does not count.
    if all
        .windows(2)
        .any(|pair| is_song_cyrillic(pair[0]) && is_song_cyrillic(pair[1]))
    {
        scripts.push(SongScript::Cyrillic);
    }
    if all.iter().any(|&c| is_greek(c)) {
        scripts.push(SongScript::Greek);
    }
    scripts
}

#[derive(Clone, Copy, Debug, Default)]
pub struct Readers {
    pub japanese: bool,
    pub as_written: bool,
    pub chinese: bool,
    pub ukrainian: bool,
}

pub(crate) struct Cell {
    pub char: char,
    pub owner: usize,
    pub out: String,
    /// A new word starts here, so the reading gets a space before it.
    pub start: bool,
}

fn read_chinese(cells: &mut [Cell]) {
    if !cells.iter().any(|cell| is_han(cell.char)) {
        return;
    }
    // Read as one text so a character with two readings takes the one its
    // word needs.
    let text: String = cells.iter().map(|cell| cell.char).collect();
    let result = pinyin::Pinyin::sentence(&text);
    let mut cursor = 0;
    for word in result.words() {
        let han: Vec<char> = word.text.chars().filter(|&c| is_han(c)).collect();
        let syllables: Vec<&str> = word.pinyin.split_whitespace().collect();
        if han.is_empty() || han.len() != syllables.len() {
            continue;
        }
        for (c, syllable) in han.into_iter().zip(syllables) {
            let Some(found) = cells[cursor..].iter().position(|cell| cell.char == c) else {
                break;
            };
            let cell = &mut cells[cursor + found];
            cell.out = syllable.to_owned();
            cell.start = true;
            cursor += found + 1;
        }
    }
}

/* Korean: Revised Romanization of how the line sounds. Each final consonant
 * meets the next syllable's initial, which moves it across a silent ㅇ,
 * softens ㄷ/ㅌ before 이, and turns stops nasal before ㄴ/ㅁ. */
const INITIALS: [&str; 19] = [
    "g", "kk", "n", "d", "tt", "r", "m", "b", "pp", "s", "ss", "", "j", "jj", "ch", "k", "t", "p",
    "h",
];
const VOWELS: [&str; 21] = [
    "a", "ae", "ya", "yae", "eo", "e", "yeo", "ye", "o", "wa", "wae", "oe", "yo", "u", "wo", "we",
    "wi", "yu", "eu", "ui", "i",
];
const FINALS: [&str; 28] = [
    "", "k", "k", "k", "n", "n", "n", "t", "l", "k", "m", "l", "l", "l", "p", "l", "m", "p", "p",
    "t", "t", "ng", "t", "t", "k", "t", "p", "t",
];
// Final consonant index to (final left behind, initial carried over).
fn carry(final_: usize) -> (usize, usize) {
    match final_ {
        1 => (0, 0),
        2 => (0, 1),
        3 => (1, 10),
        4 => (0, 2),
        5 => (4, 12),
        6 => (4, 11),
        7 => (0, 3),
        8 => (0, 5),
        9 => (8, 0),
        10 => (8, 6),
        11 => (8, 7),
        12 => (8, 10),
        13 => (8, 16),
        14 => (8, 17),
        15 => (0, 5),
        16 => (0, 6),
        17 => (0, 7),
        18 => (17, 10),
        19 => (0, 9),
        20 => (0, 10),
        22 => (0, 12),
        23 => (0, 14),
        24 => (0, 15),
        25 => (0, 16),
        26 => (0, 17),
        27 => (0, 11),
        _ => (final_, 11),
    }
}
const K_CLASS: [usize; 5] = [1, 2, 3, 9, 24];
const T_CLASS: [usize; 7] = [7, 19, 20, 22, 23, 25, 27];
const P_CLASS: [usize; 5] = [17, 18, 26, 11, 14];

fn aspirate(initial: usize) -> Option<usize> {
    match initial {
        0 => Some(15),
        3 => Some(16),
        12 => Some(14),
        _ => None,
    }
}

fn stop_aspirate(final_: usize) -> Option<usize> {
    match final_ {
        1 => Some(15),
        7 => Some(16),
        17 => Some(17),
        22 => Some(14),
        _ => None,
    }
}

/// Each syllable of a Hangul run as it sounds next to its neighbours.
pub fn korean_syllables(run: &str) -> Vec<String> {
    struct Syllable {
        initial: usize,
        vowel: usize,
        final_: usize,
        l: bool,
    }
    let mut syllables: Vec<Syllable> = run
        .chars()
        .map(|c| {
            let code = (c as usize).saturating_sub(0xAC00);
            Syllable {
                initial: code / 588,
                vowel: (code % 588) / 28,
                final_: code % 28,
                l: false,
            }
        })
        .collect();
    for index in 0..syllables.len().saturating_sub(1) {
        let (head, tail) = syllables.split_at_mut(index + 1);
        let one = &mut head[index];
        let next = &mut tail[0];
        let final_ = one.final_;
        if final_ == 0 {
            continue;
        }
        if next.initial == 11 && final_ != 21 {
            (one.final_, next.initial) = carry(final_);
            if next.initial == 5 {
                next.l = false;
            }
            if next.vowel == 20 && next.initial == 3 {
                next.initial = 12;
            }
            if next.vowel == 20 && next.initial == 16 {
                next.initial = 14;
            }
        } else if let (true, Some(initial)) =
            ([27, 6, 15].contains(&final_), aspirate(next.initial))
        {
            one.final_ = match final_ {
                27 => 0,
                6 => 4,
                _ => 8,
            };
            next.initial = initial;
        } else if let (18, Some(initial)) = (next.initial, stop_aspirate(final_)) {
            one.final_ = 0;
            next.initial = initial;
        } else if next.initial == 2 || next.initial == 6 {
            if K_CLASS.contains(&final_) {
                one.final_ = 21;
            } else if T_CLASS.contains(&final_) {
                one.final_ = 4;
            } else if P_CLASS.contains(&final_) {
                one.final_ = 16;
            } else if final_ == 8 && next.initial == 2 {
                next.initial = 5;
                next.l = true;
            }
        } else if next.initial == 5 {
            if final_ == 4 || final_ == 8 {
                one.final_ = 8;
                next.l = true;
            } else if final_ == 16 || final_ == 21 {
                next.initial = 2;
            } else if K_CLASS.contains(&final_) {
                one.final_ = 21;
                next.initial = 2;
            } else if P_CLASS.contains(&final_) {
                one.final_ = 16;
                next.initial = 2;
            }
        }
    }
    syllables
        .iter()
        .map(|syllable| {
            format!(
                "{}{}{}",
                if syllable.l {
                    "l"
                } else {
                    INITIALS[syllable.initial]
                },
                VOWELS[syllable.vowel],
                FINALS[syllable.final_]
            )
        })
        .collect()
}

pub fn romanize_korean(text: &str) -> String {
    let mut out = String::new();
    let mut run = String::new();
    for c in text.chars().chain(['\0']) {
        if is_hangul(c) {
            run.push(c);
            continue;
        }
        if !run.is_empty() {
            out.push_str(&korean_syllables(&run).concat());
            run.clear();
        }
        if c != '\0' {
            out.push(c);
        }
    }
    out
}

fn read_korean(cells: &mut [Cell]) {
    let mut index = 0;
    while index < cells.len() {
        if !is_hangul(cells[index].char) {
            index += 1;
            continue;
        }
        let mut end = index;
        while end < cells.len() && is_hangul(cells[end].char) {
            end += 1;
        }
        let run: String = cells[index..end].iter().map(|cell| cell.char).collect();
        for (offset, sound) in korean_syllables(&run).into_iter().enumerate() {
            cells[index + offset].out = sound;
        }
        index = end;
    }
}

/* Cyrillic: Russian, or Ukrainian when the song uses Ukrainian letters. */
fn russian(c: char) -> Option<&'static str> {
    Some(match c {
        'а' => "a",
        'б' => "b",
        'в' => "v",
        'г' => "g",
        'д' => "d",
        'е' => "e",
        'ё' => "yo",
        'ж' => "zh",
        'з' => "z",
        'и' => "i",
        'й' => "y",
        'к' => "k",
        'л' => "l",
        'м' => "m",
        'н' => "n",
        'о' => "o",
        'п' => "p",
        'р' => "r",
        'с' => "s",
        'т' => "t",
        'у' => "u",
        'ф' => "f",
        'х' => "kh",
        'ц' => "ts",
        'ч' => "ch",
        'ш' => "sh",
        'щ' => "shch",
        'ъ' => "",
        'ы' => "y",
        'ь' => "",
        'э' => "e",
        'ю' => "yu",
        'я' => "ya",
        'ђ' => "dj",
        'ј' => "j",
        'љ' => "lj",
        'њ' => "nj",
        'ћ' => "c",
        'џ' => "dz",
        'ѓ' => "gj",
        'ќ' => "kj",
        'ѕ' => "dz",
        'ў' => "w",
        _ => return None,
    })
}

fn ukrainian(c: char) -> Option<&'static str> {
    match c {
        'г' => Some("h"),
        'ґ' => Some("g"),
        'и' => Some("y"),
        'і' => Some("i"),
        'ї' => Some("yi"),
        'є' => Some("ye"),
        '\'' | '’' => Some(""),
        _ => russian(c),
    }
}

// Ukrainian spells these differently inside a word than at its start.
fn ukrainian_inside(c: char) -> Option<&'static str> {
    match c {
        'ї' => Some("i"),
        'є' => Some("ie"),
        'й' => Some("i"),
        'ю' => Some("iu"),
        'я' => Some("ia"),
        _ => None,
    }
}

fn lower(c: char) -> char {
    c.to_lowercase().next().unwrap_or(c)
}

fn capitalised(latin: &str) -> String {
    let mut chars = latin.chars();
    chars
        .next()
        .map(|first| first.to_uppercase().chain(chars).collect())
        .unwrap_or_default()
}

pub fn romanize_cyrillic_word(word: &str, is_ukrainian: bool) -> String {
    let letters: Vec<char> = word.chars().collect();
    let shouting = letters.len() > 1 && word == word.to_uppercase();
    letters
        .iter()
        .enumerate()
        .map(|(index, &letter)| {
            let low = lower(letter);
            let inside = if is_ukrainian && index > 0 {
                ukrainian_inside(low)
            } else {
                None
            };
            let mut latin = inside
                .or_else(|| {
                    if is_ukrainian {
                        ukrainian(low)
                    } else {
                        russian(low)
                    }
                })
                .map(str::to_owned)
                .unwrap_or_else(|| letter.to_string());
            if is_ukrainian && low == 'г' && index > 0 && lower(letters[index - 1]) == 'з' {
                latin = "gh".into();
            }
            if letter != low && !latin.is_empty() {
                latin = if shouting {
                    latin.to_uppercase()
                } else {
                    capitalised(&latin)
                };
            }
            latin
        })
        .collect()
}

fn read_cyrillic(cells: &mut [Cell], is_ukrainian: bool) {
    let letter = |c: char| is_cyrillic(c) || (is_ukrainian && matches!(c, '\'' | '’'));
    let mut index = 0;
    while index < cells.len() {
        if !is_cyrillic(cells[index].char) {
            index += 1;
            continue;
        }
        let mut end = index;
        while end < cells.len() && letter(cells[end].char) {
            end += 1;
        }
        let whole: Vec<char> = cells[index..end].iter().map(|cell| cell.char).collect();
        // Each syllable's share is read with the word around it, so a letter
        // keeps the spelling it has in the middle of the word.
        let mut read = 0;
        let mut at = index;
        while at < end {
            let owner = cells[at].owner;
            let mut group_end = at;
            while group_end < end && cells[group_end].owner == owner {
                group_end += 1;
            }
            let length = group_end - at;
            let before = romanize_cyrillic_word(
                &whole[..read + length].iter().collect::<String>(),
                is_ukrainian,
            );
            let earlier = if read > 0 {
                romanize_cyrillic_word(&whole[..read].iter().collect::<String>(), is_ukrainian)
            } else {
                String::new()
            };
            for (offset, cell) in cells[at..group_end].iter_mut().enumerate() {
                cell.out = if offset > 0 {
                    String::new()
                } else {
                    before.get(earlier.len()..).unwrap_or_default().to_owned()
                };
            }
            read += length;
            at = group_end;
        }
        index = end;
    }
}

/* Greek: ELOT 743 letters, with the common two-letter sounds. */
fn greek_letter(c: char) -> Option<&'static str> {
    Some(match c {
        'α' => "a",
        'β' => "v",
        'γ' => "g",
        'δ' => "d",
        'ε' => "e",
        'ζ' => "z",
        'η' => "i",
        'θ' => "th",
        'ι' => "i",
        'κ' => "k",
        'λ' => "l",
        'μ' => "m",
        'ν' => "n",
        'ξ' => "x",
        'ο' => "o",
        'π' => "p",
        'ρ' => "r",
        'σ' | 'ς' => "s",
        'τ' => "t",
        'υ' => "y",
        'φ' => "f",
        'χ' => "ch",
        'ψ' => "ps",
        'ω' => "o",
        _ => return None,
    })
}

/// Replaces a two-letter sound, optionally only before a voiceless
/// consonant or at the end.
fn greek_pair(text: &str, pair: &str, latin: &str, voiceless_only: bool) -> String {
    let chars: Vec<char> = text.chars().collect();
    let pair: Vec<char> = pair.chars().collect();
    let mut out = String::new();
    let mut index = 0;
    while index < chars.len() {
        if chars[index..].starts_with(&pair)
            && (!voiceless_only
                || chars
                    .get(index + 2)
                    .is_none_or(|next| "θκξπσςτφχψ".contains(*next)))
        {
            out.push_str(latin);
            index += 2;
        } else {
            out.push(chars[index]);
            index += 1;
        }
    }
    out
}

fn romanize_greek_run(run: &str) -> String {
    let capital = run.chars().next().is_some_and(|c| lower(c) != c);
    let mut out: String = run
        .nfd()
        .filter(|&c| !is_combining_mark(c))
        .collect::<String>()
        .to_lowercase();
    for (pair, latin, voiceless) in [
        ("αυ", "af", true),
        ("αυ", "av", false),
        ("ευ", "ef", true),
        ("ευ", "ev", false),
        ("ου", "ou", false),
        ("μπ", "b", false),
        ("ντ", "nt", false),
        ("γγ", "ng", false),
        ("γκ", "gk", false),
    ] {
        out = greek_pair(&out, pair, latin, voiceless);
    }
    let out: String = out
        .chars()
        .map(|c| greek_letter(c).map_or_else(|| c.to_string(), str::to_owned))
        .collect();
    if capital { capitalised(&out) } else { out }
}

pub fn romanize_greek(text: &str) -> String {
    let mut out = String::new();
    let mut run = String::new();
    for c in text.chars().chain(['\0']) {
        if is_greek(c) {
            run.push(c);
            continue;
        }
        if !run.is_empty() {
            out.push_str(&romanize_greek_run(&run));
            run.clear();
        }
        if c != '\0' {
            out.push(c);
        }
    }
    out
}

/// Greek letters, read a syllable's share at a time.
fn read_greek(cells: &mut [Cell]) {
    let mut index = 0;
    while index < cells.len() {
        if !is_greek(cells[index].char) {
            index += 1;
            continue;
        }
        let mut end = index;
        while end < cells.len()
            && is_greek(cells[end].char)
            && cells[end].owner == cells[index].owner
        {
            end += 1;
        }
        let run: String = cells[index..end].iter().map(|cell| cell.char).collect();
        let text = romanize_greek(&run);
        for (offset, cell) in cells[index..end].iter_mut().enumerate() {
            cell.out = if offset > 0 {
                String::new()
            } else {
                text.clone()
            };
        }
        index = end;
    }
}

fn is_letter(c: char) -> bool {
    c.is_alphabetic() && !is_combining_mark(c)
}

/// Letters and marks outside the Latin script, which no reader handled.
fn is_foreign(c: char) -> bool {
    matches!(c, '\u{200C}' | '\u{200D}')
        || ((c.is_alphabetic() || is_combining_mark(c)) && c.script() != Script::Latin)
}

/// Any other non-Latin letters through a general transliteration; a run it
/// cannot read stays visible.
fn transliterate_rest(text: &str) -> String {
    let mut out = String::new();
    let mut run = String::new();
    let flush = |run: &mut String, out: &mut String| {
        if run.is_empty() {
            return;
        }
        if run.chars().any(is_letter) {
            let normal: String = run.nfc().collect();
            let latin = deunicode::deunicode_with_tofu(&normal, "");
            let latin = latin.trim();
            out.push_str(if latin.is_empty() { run } else { latin });
        } else {
            out.push_str(run);
        }
        run.clear();
    };
    for c in text.chars() {
        if is_foreign(c) {
            run.push(c);
        } else {
            flush(&mut run, &mut out);
            out.push(c);
        }
    }
    flush(&mut run, &mut out);
    out
}

/// Each piece of the line romanized, keeping the line's own spaces and
/// adding one where a read word starts.
pub fn romanize_pieces(pieces: &[&str], readers: Readers) -> Vec<String> {
    let mut cells: Vec<Cell> = pieces
        .iter()
        .enumerate()
        .flat_map(|(owner, piece)| {
            piece.chars().map(move |c| Cell {
                char: c,
                owner,
                out: c.to_string(),
                start: false,
            })
        })
        .collect();
    if readers.japanese {
        japanese::read(&mut cells, readers.as_written);
    } else if readers.chinese {
        read_chinese(&mut cells);
    }
    read_korean(&mut cells);
    read_cyrillic(&mut cells, readers.ukrainian);
    read_greek(&mut cells);
    let mut out = vec![String::new(); pieces.len()];
    let mut emitted_ends_word = false;
    let mut emitted: Option<char> = None;
    for cell in &cells {
        let mut text = cell.out.clone();
        if cell.start
            && emitted_ends_word
            && !text.is_empty()
            && !text.chars().next().is_some_and(char::is_whitespace)
        {
            text.insert(0, ' ');
        }
        if let Some(last) = text.chars().last() {
            // No space goes between an opening quote and the word it opens.
            let opens = "(「『[“‘".contains(last)
                || (last == '"' && emitted.is_none_or(char::is_whitespace));
            emitted_ends_word = !last.is_whitespace() && !opens;
            emitted = Some(last);
        }
        out[cell.owner].push_str(&text);
    }
    // A line that starts with a romanized word starts with a capital.
    if let Some(first) = cells.iter().find(|cell| is_letter(cell.char))
        && first.out != first.char.to_string()
        && let Some(owner) = out.iter().position(|text| text.chars().any(is_letter))
    {
        let text = &out[owner];
        if let Some((at, letter)) = text.char_indices().find(|&(_, c)| is_letter(c)) {
            out[owner] = format!(
                "{}{}{}",
                &text[..at],
                letter.to_uppercase(),
                &text[at + letter.len_utf8()..]
            );
        }
    }
    out.into_iter()
        .map(|text| transliterate_rest(&text))
        .collect()
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
pub struct Word {
    pub text: String,
    pub start_ms: f64,
    pub end_ms: f64,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct Line {
    pub text: String,
    #[serde(default)]
    pub romanization: String,
    /// The supplied romanization timed piece by piece; a word may hold several.
    #[serde(default)]
    pub romanization_words: Vec<Word>,
    #[serde(default)]
    pub words: Vec<Word>,
}

#[derive(Clone, Debug, Default, Serialize, PartialEq)]
pub struct RomanizedWord {
    pub text: String,
    pub start_ms: f64,
    pub end_ms: f64,
    /// The source word this one keeps its other details from.
    pub from: Option<usize>,
    pub estimated: bool,
}

#[derive(Clone, Debug, Default, Serialize, PartialEq)]
pub struct RomanizedLine {
    pub text: String,
    pub words: Vec<RomanizedWord>,
}

#[derive(Clone, Copy, Debug, Deserialize)]
pub struct Options {
    /// Japanese spelled as romanized lyrics usually are: kyou, koohii, wa.
    #[serde(default = "yes")]
    pub romaji_as_written: bool,
}

fn yes() -> bool {
    true
}

impl Default for Options {
    fn default() -> Self {
        Self {
            romaji_as_written: true,
        }
    }
}

/// JavaScript's Math.round, so estimated timing matches the web view's.
fn js_round(value: f64) -> f64 {
    (value + 0.5).floor()
}

fn romanize_item(text: &str, readers: Readers) -> String {
    romanize_pieces(&[text], readers).remove(0)
}

/// The provider reads each syllable separately and joins the readings with
/// single spaces, empty for syllables it left unread. When the pieces match
/// the syllables one to one, each reading keeps its syllable's own timing.
fn per_syllable(line: &Line) -> Option<Vec<&str>> {
    if line.words.len() < 2 {
        return None;
    }
    let parts: Vec<&str> = line.romanization.split(' ').collect();
    (parts.len() == line.words.len()).then_some(parts)
}

/// Words separated by spaces, each keeping the spaces before it.
fn spaced_units(text: &str) -> Vec<String> {
    let mut units = Vec::new();
    let mut current = String::new();
    let mut seen = false;
    for c in text.chars() {
        if c.is_whitespace() && seen {
            units.push(std::mem::take(&mut current));
            seen = false;
        }
        current.push(c);
        seen |= !c.is_whitespace();
    }
    if seen {
        units.push(current);
    }
    units
}

/// Prefer authored word spans. Otherwise mark a line-wide allocation estimated.
fn supplied_words(line: &Line, text: &str) -> Vec<RomanizedWord> {
    if line.words.is_empty() {
        return Vec::new();
    }
    let units = spaced_units(text);
    let sizes =
        word_group_sizes(line.words.iter().map(|word| word.text.as_str()));
    if sizes.len() == units.len() {
        let mut first = 0;
        return sizes
            .iter()
            .zip(units)
            .map(|(&size, text)| {
                let group = &line.words[first..first + size];
                let word = RomanizedWord {
                    text,
                    start_ms: group
                        .iter()
                        .map(|word| word.start_ms)
                        .fold(f64::INFINITY, f64::min),
                    end_ms: group
                        .iter()
                        .map(|word| word.end_ms)
                        .fold(f64::NEG_INFINITY, f64::max),
                    from: Some(first),
                    estimated: false,
                };
                first += size;
                word
            })
            .collect();
    }
    let start = line
        .words
        .iter()
        .map(|word| word.start_ms)
        .fold(f64::INFINITY, f64::min);
    let end = line
        .words
        .iter()
        .map(|word| word.end_ms)
        .fold(f64::NEG_INFINITY, f64::max);
    let weights: Vec<f64> = units
        .iter()
        .map(|unit| unit.trim().chars().count().max(1) as f64)
        .collect();
    let total: f64 = weights.iter().sum();
    let mut used = 0.0;
    let count = units.len();
    units
        .into_iter()
        .enumerate()
        .map(|(index, text)| {
            let from = start + js_round((end - start) * used / total);
            used += weights[index];
            RomanizedWord {
                text,
                start_ms: from,
                end_ms: if index == count - 1 {
                    end
                } else {
                    start + js_round((end - start) * used / total)
                },
                from: None,
                estimated: true,
            }
        })
        .collect()
}

fn romanize_line(line: &Line, readers: Readers) -> Option<RomanizedLine> {
    // Readings timed syllable by syllable keep each syllable's own timing.
    if !line.romanization_words.is_empty() {
        let words: Vec<RomanizedWord> = line
            .romanization_words
            .iter()
            .map(|piece| RomanizedWord {
                text: piece.text.clone(),
                start_ms: piece.start_ms,
                end_ms: piece.end_ms,
                from: line
                    .words
                    .iter()
                    .rposition(|word| word.start_ms <= piece.start_ms + 1.0)
                    .or((!line.words.is_empty()).then_some(0)),
                estimated: false,
            })
            .collect();
        return Some(RomanizedLine {
            text: words.iter().map(|word| word.text.as_str()).collect(),
            words,
        });
    }
    let authored = line.romanization.trim();
    if !authored.is_empty() {
        if let Some(syllables) = per_syllable(line) {
            let texts: Vec<String> = line
                .words
                .iter()
                .zip(&syllables)
                .map(|(word, syllable)| {
                    let reading = syllable.trim();
                    romanize_item(
                        if reading.is_empty() {
                            word.text.trim()
                        } else {
                            reading
                        },
                        readers,
                    )
                })
                .collect();
            let words: Vec<RomanizedWord> = line
                .words
                .iter()
                .enumerate()
                .map(|(index, word)| {
                    let text = texts[index].trim();
                    // Readings stand apart as the provider's line did;
                    // untouched syllables keep their own joins.
                    let spaced = index > 0
                        && (word.text.starts_with(char::is_whitespace)
                            || text != word.text.trim()
                            || texts[index - 1].trim() != line.words[index - 1].text.trim());
                    RomanizedWord {
                        text: if spaced {
                            format!(" {text}")
                        } else {
                            text.to_owned()
                        },
                        start_ms: word.start_ms,
                        end_ms: word.end_ms,
                        from: Some(index),
                        estimated: false,
                    }
                })
                .collect();
            return Some(RomanizedLine {
                text: words.iter().map(|word| word.text.as_str()).collect(),
                words,
            });
        }
        let supplied = romanize_item(authored, readers);
        return Some(RomanizedLine {
            words: supplied_words(line, &supplied),
            text: supplied,
        });
    }
    // The whole line is read at once so a word split over syllables keeps
    // its reading.
    let pieces: Vec<&str> = if line.words.is_empty() {
        vec![line.text.as_str()]
    } else {
        line.words.iter().map(|word| word.text.as_str()).collect()
    };
    let texts = romanize_pieces(&pieces, readers);
    if line.words.is_empty() {
        return (texts[0] != line.text).then(|| RomanizedLine {
            text: texts[0].clone(),
            words: Vec::new(),
        });
    }
    let words: Vec<RomanizedWord> = line
        .words
        .iter()
        .zip(texts)
        .enumerate()
        .map(|(index, (word, text))| RomanizedWord {
            text,
            start_ms: word.start_ms,
            end_ms: word.end_ms,
            from: Some(index),
            estimated: false,
        })
        .collect();
    let text: String = words.iter().map(|word| word.text.as_str()).collect();
    let unchanged = text == line.text
        && words
            .iter()
            .zip(&line.words)
            .all(|(new, old)| new.text == old.text);
    (!unchanged).then_some(RomanizedLine { text, words })
}

/// Each line romanized, or None where it reads the same: supplied
/// romanization first, then the song's converters over each word (or each
/// line without word timing).
pub fn romanize_lines(lines: &[Line], options: Options) -> Vec<Option<RomanizedLine>> {
    let texts = lines.iter().flat_map(|line| {
        std::iter::once(line.text.as_str()).chain(line.words.iter().map(|word| word.text.as_str()))
    });
    let scripts = song_scripts(texts.clone());
    // As in the fork, no reader loads when the lyrics bring every reading.
    let readers = if lines
        .iter()
        .all(|line| !line.romanization.trim().is_empty())
    {
        Readers::default()
    } else {
        Readers {
            japanese: scripts.contains(&SongScript::Japanese),
            as_written: options.romaji_as_written,
            chinese: scripts.contains(&SongScript::Chinese),
            ukrainian: texts.flat_map(str::chars).any(|c| "іїєґІЇЄҐ".contains(c)),
        }
    };
    lines
        .iter()
        .map(|line| romanize_line(line, readers))
        .collect()
}

pub fn js_space(c: char) -> bool {
    c.is_whitespace() || c == '\u{FEFF}'
}

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

mod wasm;
