//! Japanese readings: IPADIC tokens (the dictionary kuromoji also uses),
//! split over the syllables they span, spelled in Hepburn.

use std::{borrow::Cow, collections::HashMap, sync::OnceLock};

use lindera::{dictionary::load_dictionary, mode::Mode, segmenter::Segmenter};

use crate::{Cell, hepburn::HEPBURN, is_space};

pub struct Token {
    pub surface: String,
    pub pos: String,
    pub pos_detail: String,
    pub reading: Option<String>,
    pub pronunciation: Option<String>,
}

fn segmenter() -> Option<&'static Segmenter> {
    static SEGMENTER: OnceLock<Option<Segmenter>> = OnceLock::new();
    SEGMENTER
        .get_or_init(|| {
            load_dictionary("embedded://ipadic")
                .ok()
                .map(|dictionary| Segmenter::new(Mode::Normal, dictionary, None))
        })
        .as_ref()
}

pub fn tokenize(text: &str) -> Vec<Token> {
    let Some(segmenter) = segmenter() else {
        return Vec::new();
    };
    let Ok(mut tokens) = segmenter.segment(Cow::Borrowed(text)) else {
        return Vec::new();
    };
    tokens
        .iter_mut()
        .map(|token| {
            let surface = token.surface.to_string();
            let details = token.details();
            let field = |index: usize| {
                details
                    .get(index)
                    .filter(|value| **value != "*" && !value.is_empty())
                    .map(|value| value.to_string())
            };
            Token {
                pos: field(0).unwrap_or_default(),
                pos_detail: field(1).unwrap_or_default(),
                reading: field(7),
                pronunciation: field(8),
                surface,
            }
        })
        .collect()
}

pub fn is_kana(c: char) -> bool {
    matches!(c, '\u{3041}'..='\u{3096}' | '\u{30A1}'..='\u{30FA}' | 'ー')
}

pub fn is_japanese(c: char) -> bool {
    matches!(c, '\u{3040}'..='\u{30FF}' | '々' | '〆') || crate::is_han(c)
}

fn to_katakana(text: &str) -> String {
    text.chars()
        .map(|c| match c {
            '\u{3041}'..='\u{3096}' => char::from_u32(c as u32 + 0x60).unwrap_or(c),
            _ => c,
        })
        .collect()
}

/// Splits a token's reading over its characters: kana read as themselves
/// and each kanji run takes what is left, all on the run's first character.
/// None when the reading does not fit the written kana.
pub fn align_reading(surface: &str, reading: &str) -> Option<Vec<String>> {
    struct Run {
        kana: bool,
        text: Vec<char>,
        from: usize,
    }
    let chars: Vec<char> = surface.chars().collect();
    let mut runs: Vec<Run> = Vec::new();
    for (index, &c) in chars.iter().enumerate() {
        let kana = is_kana(c);
        match runs.last_mut() {
            Some(last) if last.kana == kana => last.text.push(c),
            _ => runs.push(Run {
                kana,
                text: vec![c],
                from: index,
            }),
        }
    }
    let reading: Vec<char> = to_katakana(reading).chars().collect();
    let patterns: Vec<Option<Vec<char>>> = runs
        .iter()
        .map(|run| {
            run.kana.then(|| {
                to_katakana(&run.text.iter().collect::<String>())
                    .chars()
                    .collect()
            })
        })
        .collect();
    // Kanji runs take as little as they can, as a lazy pattern would.
    fn fit(patterns: &[Option<Vec<char>>], reading: &[char], taken: &mut Vec<String>) -> bool {
        let Some((first, rest)) = patterns.split_first() else {
            return reading.is_empty();
        };
        match first {
            Some(kana) => reading.starts_with(kana) && fit(rest, &reading[kana.len()..], taken),
            None => {
                for length in 1..=reading.len() {
                    taken.push(reading[..length].iter().collect());
                    if fit(rest, &reading[length..], taken) {
                        return true;
                    }
                    taken.pop();
                }
                false
            }
        }
    }
    let mut taken = Vec::new();
    if !fit(&patterns, &reading, &mut taken) {
        return None;
    }
    let mut out = vec![String::new(); chars.len()];
    let mut groups = taken.into_iter();
    for run in &runs {
        if run.kana {
            for (offset, c) in run.text.iter().enumerate() {
                out[run.from + offset] = to_katakana(&c.to_string());
            }
        } else {
            let reading = groups.next().unwrap_or_default();
            for (offset, piece) in split_over_kanji(&reading, run.text.len())
                .into_iter()
                .enumerate()
            {
                out[run.from + offset] = piece;
            }
        }
    }
    Some(out)
}

/// A kanji run's reading shared out over its kanji, syllable by syllable,
/// so a word sung over several syllables gets a reading on each.
fn split_over_kanji(reading: &str, kanji: usize) -> Vec<String> {
    let mut syllables: Vec<String> = Vec::new();
    for c in reading.chars() {
        let joins = match syllables.last() {
            None => false,
            Some(last) => {
                let vowel = kana_to_romaji(last).chars().last();
                "ャュョァィゥェォヮーンッ".contains(c)
                    || (c == 'イ' && !last.ends_with(['ン', 'ッ']))
                    || (c == 'ウ' && matches!(vowel, Some('o' | 'u')))
            }
        };
        match syllables.last_mut() {
            Some(last) if joins => last.push(c),
            _ => syllables.push(c.to_string()),
        }
    }
    let count = syllables.len();
    (0..kanji)
        .map(|index| syllables[index * count / kanji..(index + 1) * count / kanji].concat())
        .collect()
}

fn hepburn() -> &'static HashMap<&'static str, &'static str> {
    static TABLE: OnceLock<HashMap<&'static str, &'static str>> = OnceLock::new();
    TABLE.get_or_init(|| HEPBURN.iter().copied().collect())
}

fn replace_pairs(text: &str, pairs: &[(&str, &str)]) -> String {
    pairs
        .iter()
        .fold(text.to_owned(), |text, (from, to)| text.replace(from, to))
}

/// Kana to Hepburn romaji, as kuroshiro's `kanaToRomaji(kana, "hepburn")`.
pub fn kana_to_romaji(kana: &str) -> String {
    let table = hepburn();
    let chars: Vec<char> = kana.chars().collect();
    // A syllabic n before a vowel or y sound is marked off: kin'en.
    let mut marked: Vec<char> = Vec::with_capacity(chars.len());
    for (index, &c) in chars.iter().enumerate() {
        marked.push(c);
        if matches!(c, 'ん' | 'ン')
            && chars.get(index + 1).is_some_and(|next| {
                "あいうえおアイウエオぁぃぅぇぉァィゥェォやゆよヤユヨゃゅょャュョ".contains(*next)
            })
        {
            marked.push('\'');
        }
    }
    let mut result = String::new();
    let mut at = 0;
    while at < marked.len() {
        if at + 1 < marked.len() {
            let pair: String = marked[at..at + 2].iter().collect();
            if let Some(latin) = table.get(pair.as_str()) {
                result.push_str(latin);
                at += 2;
                continue;
            }
        }
        let single = marked[at].to_string();
        result.push_str(table.get(single.as_str()).copied().unwrap_or(&single));
        at += 1;
    }
    // A small tsu doubles the consonant after it.
    let out: Vec<char> = result.chars().collect();
    let mut doubled = String::new();
    let mut index = 0;
    while index < out.len() {
        if matches!(out[index], 'っ' | 'ッ')
            && out
                .get(index + 1)
                .is_some_and(|next| "bcdfghijklmnopqrstuvwyz".contains(*next))
        {
            doubled.push(out[index + 1]);
            doubled.push(out[index + 1]);
            index += 2;
        } else {
            doubled.push(out[index]);
            index += 1;
        }
    }
    let result = doubled.replace("cc", "tc").replace(['っ', 'ッ'], "tsu");
    replace_pairs(
        &result,
        &[
            ("nm", "mm"),
            ("nb", "mb"),
            ("np", "mp"),
            ("aー", "ā"),
            ("iー", "ī"),
            ("uー", "ū"),
            ("eー", "ē"),
            ("oー", "ō"),
        ],
    )
}

/// Spellings the dictionary misreads, swapped for ones it knows before
/// tokenizing. Each keeps its length, so tokens still line up with the text.
const RESPELLINGS: [(&str, &str); 1] = [("失く", "無く")];

/// Tokens that romanized lyrics write as two words, and where the second
/// one starts.
fn second_word(surface: &str) -> Option<usize> {
    Some(match surface {
        "こんなに" | "そんなに" | "あんなに" | "どんなに" => 3,
        "という" | "といった" => 1,
        "二度と" => 2,
        _ => return None,
    })
}

const MACRONS: [(&str, &str); 10] = [
    ("ā", "aa"),
    ("ī", "ii"),
    ("ū", "uu"),
    ("ē", "ee"),
    ("ō", "oo"),
    ("Ā", "Aa"),
    ("Ī", "Ii"),
    ("Ū", "Uu"),
    ("Ē", "Ee"),
    ("Ō", "Oo"),
];

fn mark(c: char) -> Option<&'static str> {
    Some(match c {
        '、' => ",",
        '。' => ".",
        '「' | '」' | '『' | '』' => "\"",
        '！' => "!",
        '？' => "?",
        '～' | '〜' => "~",
        '・' | '　' => " ",
        '（' => "(",
        '）' => ")",
        _ => return None,
    })
}

/// Spoken contractions of a te-form helper stay on their verb: てる, てく.
fn contracted(token: &Token, previous: Option<&str>) -> bool {
    token.pos == "動詞"
        && token.pos_detail == "非自立"
        && (token.surface.starts_with(['て', 'で'])
            || (matches!(previous, Some("て" | "で"))
                && token.surface.starts_with(['く', 'き', 'け', 'こ'])))
}

pub(crate) fn read(cells: &mut [Cell], as_written: bool) {
    if !cells.iter().any(|cell| is_japanese(cell.char)) {
        return;
    }
    // Lyrics often put a space after every Japanese syllable; reading those
    // one by one turns kanji into the wrong words.
    let neighbour = |cells: &[Cell], from: usize, forward: bool| -> Option<char> {
        let mut at = from;
        loop {
            if forward {
                at += 1;
                if at >= cells.len() {
                    return None;
                }
            } else {
                at = at.checked_sub(1)?;
            }
            if !is_space(cells[at].char) {
                return Some(cells[at].char);
            }
        }
    };
    let mut kept: Vec<usize> = Vec::new();
    for index in 0..cells.len() {
        if is_space(cells[index].char)
            && neighbour(cells, index, false).is_some_and(is_japanese)
            && neighbour(cells, index, true).is_some_and(is_japanese)
        {
            cells[index].out.clear();
        } else {
            kept.push(index);
        }
    }
    let written: Vec<char> = kept.iter().map(|&index| cells[index].char).collect();
    let mut text: String = written.iter().collect();
    for (from, to) in RESPELLINGS {
        text = text.replace(from, to);
    }
    let spelled: Vec<char> = text.chars().collect();
    let tokens = tokenize(&text);
    let mut at = 0;
    let mut previous_pos: Option<String> = None;
    let mut previous_surface: Option<String> = None;
    // A small tsu that ends one token doubles the sound starting the next.
    let mut carried = String::new();
    for token in &tokens {
        let found: Vec<char> = token.surface.chars().collect();
        // The tokenizer leaves out whitespace, so find where this token is.
        while at < spelled.len() && !spelled[at..].starts_with(&found) {
            at += 1;
        }
        let chars: Vec<char> = written[at.min(written.len())..]
            .iter()
            .take(found.len())
            .copied()
            .collect();
        let surface: String = chars.iter().collect();
        let indices: Vec<usize> = kept.iter().skip(at).take(chars.len()).copied().collect();
        at += chars.len();
        let before = previous_pos.replace(token.pos.clone());
        if indices.is_empty() || !chars.iter().any(|&c| is_japanese(c)) {
            carried.clear();
            continue;
        }
        let particle = token.pos == "助詞";
        // Endings stay on their word: a verb's te-form or past tense.
        let attaches = ((token.pos == "助動詞" || token.pos_detail == "接続助詞")
            && before
                .as_deref()
                .is_some_and(|pos| ["動詞", "形容詞", "助動詞"].contains(&pos)))
            || token.pos_detail == "接尾"
            || contracted(token, previous_surface.as_deref());
        previous_surface = Some(token.surface.clone());
        let mut kana = if as_written {
            token.reading.clone()
        } else {
            token
                .pronunciation
                .clone()
                .or_else(|| token.reading.clone())
        }
        .unwrap_or_default();
        if kana.is_empty() {
            kana = if chars.iter().all(|&c| is_kana(c)) {
                token.surface.clone()
            } else {
                String::new()
            };
        }
        if kana.is_empty() {
            carried.clear();
            continue;
        }
        if particle && surface == "は" {
            kana = "ワ".into();
        }
        if particle && surface == "へ" {
            kana = "エ".into();
        }
        let aligned = align_reading(&surface, &kana).unwrap_or_else(|| {
            std::iter::once(to_katakana(&kana))
                .chain(chars.iter().skip(1).map(|_| String::new()))
                .collect()
        });
        // One piece of reading per syllable the token spans.
        let mut groups: Vec<(usize, String)> = Vec::new();
        for (offset, &index) in indices.iter().enumerate() {
            let piece = aligned.get(offset).cloned().unwrap_or_default();
            match groups.last_mut() {
                Some((first, text)) if cells[*first].owner == cells[index].owner => {
                    text.push_str(&piece)
                }
                _ => groups.push((index, piece)),
            }
        }
        // Small kana and long marks belong to the sound before them; a small
        // tsu doubles the sound after it.
        for index in 1..groups.len() {
            let (head, tail) = groups.split_at_mut(index);
            let before = &mut head[index - 1].1;
            let group = &mut tail[0].1;
            while let Some(first) = group.chars().next() {
                if !"ャュョァィゥェォヮー".contains(first) {
                    break;
                }
                before.push(first);
                group.remove(0);
            }
            if before.ends_with('ッ') && !group.is_empty() {
                before.pop();
                group.insert(0, 'ッ');
            }
        }
        if let Some(first) = groups.first_mut() {
            first.1.insert_str(0, &carried);
        }
        carried.clear();
        if let Some(last) = groups.last_mut()
            && last.1.ends_with('ッ')
        {
            last.1.pop();
            carried.push('ッ');
        }
        for &index in &indices {
            cells[index].out.clear();
        }
        let spell = |kana: &str| {
            let mut romaji = if particle && surface == "を" && as_written {
                "wo".to_owned()
            } else {
                kana_to_romaji(kana)
            };
            if as_written {
                romaji = replace_pairs(&romaji, &MACRONS);
            }
            romaji.replace('ッ', "")
        };
        let split = second_word(&surface).filter(|&offset| offset < aligned.len());
        for (number, (first, kana)) in groups.iter().enumerate() {
            cells[*first].out = spell(kana);
            if number == 0 && !attaches {
                cells[*first].start = true;
            }
        }
        if let Some(offset) = split
            && let Some(&index) = indices.get(offset)
        {
            if groups.iter().any(|(first, _)| *first == index) {
                cells[index].start = true;
            } else if groups.len() == 1 {
                let head: String = aligned[..offset].concat();
                let tail: String = aligned[offset..].concat();
                cells[groups[0].0].out = format!("{} {}", spell(&head), spell(&tail));
            }
        }
    }
    for cell in cells.iter_mut() {
        if let Some(latin) = mark(cell.char)
            && cell.out == cell.char.to_string()
        {
            cell.out = latin.to_owned();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn readings_split_over_the_kana_around_a_kanji() {
        let split = |surface, reading| align_reading(surface, reading);
        assert_eq!(split("抱い", "ダイ"), Some(vec!["ダ".into(), "イ".into()]));
        assert_eq!(
            split("一緒", "イッショ"),
            Some(vec!["イッ".into(), "ショ".into()])
        );
        assert_eq!(
            split("金輪際", "コンリンザイ"),
            Some(vec!["コン".into(), "リン".into(), "ザイ".into()])
        );
        assert_eq!(
            split("呼吸", "コキュウ"),
            Some(vec!["コ".into(), "キュウ".into()])
        );
        assert_eq!(
            split("悠久", "ユウキュウ"),
            Some(vec!["ユウ".into(), "キュウ".into()])
        );
        assert_eq!(split("行く", "ユク"), Some(vec!["ユ".into(), "ク".into()]));
        assert_eq!(split("言う", "ユー"), None);
    }

    #[test]
    fn hepburn_matches_kuroshiro() {
        assert_eq!(kana_to_romaji("トウキョウ"), "toukyou");
        assert_eq!(kana_to_romaji("コーヒー"), "kōhī");
        assert_eq!(kana_to_romaji("チョット"), "chotto");
        assert_eq!(kana_to_romaji("キンエン"), "kin'en");
        assert_eq!(kana_to_romaji("シンブン"), "shimbun");
    }
}
