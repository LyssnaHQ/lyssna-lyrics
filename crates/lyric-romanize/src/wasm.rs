use std::cell::RefCell;

use serde::Deserialize;

use crate::{Line, Options, romanize_lines};

#[derive(Deserialize)]
struct Request {
    lines: Vec<Line>,
    options: Options,
}

// The worker owns the engine and sends exactly one request at a time.
thread_local! {
    static INPUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    static OUTPUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

#[unsafe(no_mangle)]
pub extern "C" fn prepare_input(len: usize) -> *mut u8 {
    INPUT.with_borrow_mut(|input| {
        input.resize(len, 0);
        input.as_mut_ptr()
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn romanize() -> usize {
    let request = INPUT.with_borrow(|input| serde_json::from_slice::<Request>(input));
    let Ok(request) = request else {
        return 0;
    };
    let output = serde_json::to_vec(&romanize_lines(&request.lines, request.options));
    OUTPUT.with_borrow_mut(|buffer| {
        *buffer = output.unwrap_or_default();
        buffer.len()
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn output_ptr() -> *const u8 {
    OUTPUT.with_borrow(|output| output.as_ptr())
}
