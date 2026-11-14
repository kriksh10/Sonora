// GUI subsystem on purpose. A console binary spawned from the Electron window
// hangs in CRT startup and flashes a console. Status goes to the inherited
// stdout handle, which Node sets up as a pipe.
#![windows_subsystem = "windows"]

#[link(name = "kernel32")]
extern "system" {
    fn GetStdHandle(kind: u32) -> isize;
    fn WriteFile(
        handle: isize,
        buffer: *const u8,
        length: u32,
        written: *mut u32,
        overlapped: *mut core::ffi::c_void,
    ) -> i32;
}

#[link(name = "user32")]
extern "system" {
    fn GetWindow(hwnd: isize, cmd: u32) -> isize;
    fn GetWindowLongPtrW(hwnd: isize, index: i32) -> isize;
    fn SetWindowLongPtrW(hwnd: isize, index: i32, value: isize) -> isize;
    fn GetClassNameW(hwnd: isize, name: *mut u16, max: i32) -> i32;
    fn IsWindowVisible(hwnd: isize) -> i32;
    fn SetWindowPos(hwnd: isize, insert: isize, x: i32, y: i32, cx: i32, cy: i32, flags: u32) -> i32;
}

const GW_CHILD: u32 = 5;
const GW_HWNDNEXT: u32 = 2;
const GWL_EXSTYLE: i32 = -20;
const WS_EX_TRANSPARENT: isize = 0x20;
const SWP_NOSIZE: u32 = 0x0001;
const SWP_NOMOVE: u32 = 0x0002;
const SWP_NOZORDER: u32 = 0x0004;
const SWP_NOACTIVATE: u32 = 0x0010;
const SWP_FRAMECHANGED: u32 = 0x0020;
const STD_OUTPUT_HANDLE: u32 = 0xFFFFFFF5;

fn emit(line: &str) {
    let handle = unsafe { GetStdHandle(STD_OUTPUT_HANDLE) };
    if handle == 0 || handle == -1 {
        return;
    }
    let mut bytes = Vec::with_capacity(line.len() + 1);
    bytes.extend_from_slice(line.as_bytes());
    bytes.push(b'\n');
    let mut written = 0u32;
    unsafe {
        WriteFile(handle, bytes.as_ptr(), bytes.len() as u32, &mut written, core::ptr::null_mut());
    }
}

fn class_name(hwnd: isize) -> String {
    let mut buf = [0u16; 256];
    let len = unsafe { GetClassNameW(hwnd, buf.as_mut_ptr(), buf.len() as i32) };
    if len <= 0 {
        return String::new();
    }
    String::from_utf16_lossy(&buf[..len as usize])
}

fn repair_widget(hwnd: isize) -> Option<String> {
    let name = class_name(hwnd);
    if !name.contains("RenderWidgetHost") {
        return None;
    }
    let ex = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) };
    let visible = unsafe { IsWindowVisible(hwnd) } != 0;
    let mut note = format!("hwnd={hwnd} class={name} ex=0x{ex:X} visible={visible}");
    if ex & WS_EX_TRANSPARENT != 0 {
        unsafe {
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex & !WS_EX_TRANSPARENT);
            SetWindowPos(
                hwnd,
                0,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
            );
        }
        let after = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) };
        note.push_str(&format!(" cleared ex=0x{after:X}"));
    }
    Some(note)
}

fn main() {
    let hwnd = std::env::args()
        .nth(1)
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(0) as isize;
    if hwnd == 0 {
        emit("parent-visible=0");
        return;
    }
    let parent_visible = unsafe { IsWindowVisible(hwnd) } != 0;
    let mut notes = vec![format!("parent-visible={}", if parent_visible { 1 } else { 0 })];
    if parent_visible {
        let mut child = unsafe { GetWindow(hwnd, GW_CHILD) };
        let mut guard = 0;
        while child != 0 && guard < 32 {
            if let Some(note) = repair_widget(child) {
                notes.push(note);
            }
            child = unsafe { GetWindow(child, GW_HWNDNEXT) };
            guard += 1;
        }
    }
    emit(&notes.join(" | "));
}
