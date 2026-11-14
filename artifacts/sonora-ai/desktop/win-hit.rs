// GUI subsystem on purpose. A console binary spawned from the Electron window
// hangs in CRT startup and flashes a console. Status goes to the inherited
// stdout handle, which Node sets up as a pipe.
#![windows_subsystem = "windows"]

#[link(name = "kernel32")]
extern "system" {
    fn GetStdHandle(kind: u32) -> isize;
    fn GetCurrentThreadId() -> u32;
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
    fn GetClassNameW(hwnd: isize, name: *mut u16, max: i32) -> i32;
    fn IsWindowVisible(hwnd: isize) -> i32;
    fn SetWindowsHookExW(id: i32, hook: HookProc, module: isize, thread: u32) -> isize;
    fn CallNextHookEx(hook: isize, code: i32, wparam: usize, lparam: isize) -> isize;
    fn GetMessageW(msg: *mut Msg, hwnd: isize, min: u32, max: u32) -> i32;
    fn PeekMessageW(msg: *mut Msg, hwnd: isize, min: u32, max: u32, remove: u32) -> i32;
    fn PostThreadMessageW(thread: u32, msg: u32, wparam: usize, lparam: isize) -> i32;
}

type HookProc = unsafe extern "system" fn(code: i32, wparam: usize, lparam: isize) -> isize;

#[repr(C)]
struct WinPoint {
    x: i32,
    y: i32,
}

#[repr(C)]
struct MouseHook {
    pt: WinPoint,
    mouse_data: u32,
    flags: u32,
    time: u32,
    extra: usize,
}

#[repr(C)]
struct Msg {
    hwnd: isize,
    message: u32,
    wparam: usize,
    lparam: isize,
    time: u32,
    pt: WinPoint,
}

const WH_MOUSE_LL: i32 = 14;
const HC_ACTION: i32 = 0;
const WM_LBUTTONDOWN: usize = 0x0201;
const WM_LBUTTONUP: usize = 0x0202;
const WM_APP_CLICK: u32 = 0x8000;

use std::sync::atomic::{AtomicIsize, AtomicU32, Ordering};
static HOOK: AtomicIsize = AtomicIsize::new(0);
static HOOK_THREAD: AtomicU32 = AtomicU32::new(0);

unsafe extern "system" fn mouse_hook(code: i32, wparam: usize, lparam: isize) -> isize {
    if code == HC_ACTION && lparam != 0 && (wparam == WM_LBUTTONDOWN || wparam == WM_LBUTTONUP) {
        let info = &*(lparam as *const MouseHook);
        let message = if wparam == WM_LBUTTONDOWN { WM_APP_CLICK } else { WM_APP_CLICK + 1 };
        PostThreadMessageW(
            HOOK_THREAD.load(Ordering::Relaxed),
            message,
            info.pt.x as u32 as usize,
            info.pt.y as i32 as isize,
        );
    }
    CallNextHookEx(HOOK.load(Ordering::Relaxed), code, wparam, lparam)
}

fn watch_clicks() {
    HOOK_THREAD.store(unsafe { GetCurrentThreadId() }, Ordering::Relaxed);
    let mut msg = Msg { hwnd: 0, message: 0, wparam: 0, lparam: 0, time: 0, pt: WinPoint { x: 0, y: 0 } };
    // Creating the queue first lets the hook post a click before GetMessage runs.
    unsafe { PeekMessageW(&mut msg, 0, 0, 0, 0) };
    let hook = unsafe { SetWindowsHookExW(WH_MOUSE_LL, mouse_hook, 0, 0) };
    if hook == 0 {
        emit("watch-failed");
        return;
    }
    HOOK.store(hook, Ordering::Relaxed);
    emit("watch-ready");
    loop {
        let status = unsafe { GetMessageW(&mut msg, 0, 0, 0) };
        if status <= 0 {
            break;
        }
        if msg.message == WM_APP_CLICK || msg.message == WM_APP_CLICK + 1 {
            let x = msg.wparam as u32 as i32;
            let y = msg.lparam as u32 as i32;
            let kind = if msg.message == WM_APP_CLICK { "down" } else { "up" };
            emit(&format!("{kind} {x} {y}"));
        }
    }
}

const GW_CHILD: u32 = 5;
const GW_HWNDNEXT: u32 = 2;
const GWL_EXSTYLE: i32 = -20;
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

fn describe_widget(hwnd: isize) -> Option<String> {
    let name = class_name(hwnd);
    if !name.contains("RenderWidgetHost") {
        return None;
    }
    // Leave WS_EX_TRANSPARENT set. Clearing it makes this child the hit target,
    // and the legacy render-widget window swallows the title-bar click.
    let ex = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) };
    let visible = unsafe { IsWindowVisible(hwnd) } != 0;
    Some(format!("hwnd={hwnd} class={name} ex=0x{ex:X} visible={visible}"))
}

fn main() {
    if std::env::args().nth(1).as_deref() == Some("--watch") {
        watch_clicks();
        return;
    }
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
            if let Some(note) = describe_widget(child) {
                notes.push(note);
            }
            child = unsafe { GetWindow(child, GW_HWNDNEXT) };
            guard += 1;
        }
    }
    emit(&notes.join(" | "));
}
