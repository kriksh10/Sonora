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
    fn GetCursorPos(point: *mut WinPoint) -> i32;
    fn GetWindowRect(hwnd: isize, rect: *mut WinRect) -> i32;
    fn SetWindowPos(hwnd: isize, insert_after: isize, x: i32, y: i32, cx: i32, cy: i32, flags: u32) -> i32;
    fn SetProcessDpiAwarenessContext(value: isize) -> i32;
    fn SetProcessDPIAware() -> i32;
    fn GetDpiForWindow(hwnd: isize) -> u32;
}

type HookProc = unsafe extern "system" fn(code: i32, wparam: usize, lparam: isize) -> isize;

#[repr(C)]
struct WinPoint {
    x: i32,
    y: i32,
}

#[repr(C)]
struct WinRect {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
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
const WM_MOUSEMOVE: usize = 0x0200;
const WM_LBUTTONDOWN: usize = 0x0201;
const WM_LBUTTONUP: usize = 0x0202;
const WM_APP_CLICK: u32 = 0x8000;
const WM_APP_DRAG_START: u32 = 0x8002;
const WM_APP_DRAG_ON: u32 = 0x8003;
const WM_APP_DRAG_END: u32 = 0x8004;
const WM_APP_MOVE: u32 = 0x8005;
const SWP_NOSIZE: u32 = 0x0001;
const SWP_NOZORDER: u32 = 0x0004;
const SWP_NOACTIVATE: u32 = 0x0010;

use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU32, Ordering};
static HOOK: AtomicIsize = AtomicIsize::new(0);
static HOOK_THREAD: AtomicU32 = AtomicU32::new(0);
static DRAG_ACTIVE: AtomicBool = AtomicBool::new(false);

unsafe extern "system" fn mouse_hook(code: i32, wparam: usize, lparam: isize) -> isize {
    if code == HC_ACTION && lparam != 0 {
        let thread = HOOK_THREAD.load(Ordering::Relaxed);
        if wparam == WM_LBUTTONDOWN || wparam == WM_LBUTTONUP {
            let info = &*(lparam as *const MouseHook);
            let message = if wparam == WM_LBUTTONDOWN { WM_APP_CLICK } else { WM_APP_CLICK + 1 };
            PostThreadMessageW(thread, message, info.pt.x as u32 as usize, info.pt.y as i32 as isize);
        } else if wparam == WM_MOUSEMOVE && DRAG_ACTIVE.load(Ordering::Relaxed) {
            // Wake the message thread. It reads GetCursorPos itself so the move
            // stays in the same coordinate space as GetWindowRect.
            PostThreadMessageW(thread, WM_APP_MOVE, 0, 0);
        }
    }
    CallNextHookEx(HOOK.load(Ordering::Relaxed), code, wparam, lparam)
}

struct NativeDrag {
    hwnd: isize,
    origin_x: i32,
    origin_y: i32,
    origin_w: i32,
    origin_h: i32,
    grab_x: i32,
    grab_y: i32,
    start_dpi: u32,
}

fn monitor_dpi(hwnd: isize) -> u32 {
    // 0 means the DPI is unknown. The move then uses SWP_NOSIZE.
    unsafe { GetDpiForWindow(hwnd) }
}

fn scale_dim(origin: i32, start_dpi: u32, dpi: u32) -> i32 {
    let value = (origin as i64 * dpi as i64 + start_dpi as i64 / 2) / start_dpi as i64;
    value.clamp(1, 100_000) as i32
}

fn place_drag(drag: &NativeDrag) {
    let mut cursor = WinPoint { x: 0, y: 0 };
    if unsafe { GetCursorPos(&mut cursor) } == 0 {
        return;
    }
    let x = drag.origin_x.saturating_add(cursor.x.saturating_sub(drag.grab_x));
    let y = drag.origin_y.saturating_add(cursor.y.saturating_sub(drag.grab_y));
    let dpi = monitor_dpi(drag.hwnd);
    if drag.start_dpi > 0 && dpi > 0 && dpi != drag.start_dpi {
        // Crossing monitors changes the DPI. Scale the original pixel size once
        // from that DPI so the DIP size stays put and rounding cannot accumulate.
        let width = scale_dim(drag.origin_w, drag.start_dpi, dpi);
        let height = scale_dim(drag.origin_h, drag.start_dpi, dpi);
        unsafe {
            SetWindowPos(drag.hwnd, 0, x, y, width, height, SWP_NOZORDER | SWP_NOACTIVATE);
        }
        return;
    }
    // SWP_NOSIZE does not write the width or height, so a fractional scale
    // cannot round the window up on the next move.
    unsafe {
        SetWindowPos(drag.hwnd, 0, x, y, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
    }
}

fn read_drag_commands() {
    use std::io::BufRead;
    let stdin = std::io::stdin();
    let mut lines = stdin.lock().lines();
    while let Some(line) = lines.next() {
        let Ok(line) = line else { break };
        let line = line.trim();
        let thread = HOOK_THREAD.load(Ordering::Relaxed);
        if let Some(hwnd) = line.strip_prefix("drag-start ") {
            if let Ok(value) = hwnd.trim().parse::<u64>() {
                unsafe { PostThreadMessageW(thread, WM_APP_DRAG_START, value as usize, 0) };
            }
        } else if line == "drag-on" {
            unsafe { PostThreadMessageW(thread, WM_APP_DRAG_ON, 0, 0) };
        } else if line == "drag-end" {
            unsafe { PostThreadMessageW(thread, WM_APP_DRAG_END, 0, 0) };
        }
    }
}

fn watch_clicks() {
    HOOK_THREAD.store(unsafe { GetCurrentThreadId() }, Ordering::Relaxed);
    let mut msg = Msg { hwnd: 0, message: 0, wparam: 0, lparam: 0, time: 0, pt: WinPoint { x: 0, y: 0 } };
    // Creating the queue first lets the hook post a click before GetMessage runs.
    unsafe { PeekMessageW(&mut msg, 0, 0, 0, 0) };
    std::thread::spawn(read_drag_commands);
    let hook = unsafe { SetWindowsHookExW(WH_MOUSE_LL, mouse_hook, 0, 0) };
    if hook == 0 {
        emit("watch-failed");
        return;
    }
    HOOK.store(hook, Ordering::Relaxed);
    emit("watch-ready");
    let mut button_down = false;
    let mut grab = WinPoint { x: 0, y: 0 };
    let mut pending_hwnd: isize = 0;
    let mut apply_when_armed = false;
    let mut drag: Option<NativeDrag> = None;
    let try_arm = |pending_hwnd: &mut isize, grab: &WinPoint, button_down: bool, apply_when_armed: bool, drag: &mut Option<NativeDrag>| {
        if *pending_hwnd == 0 || !button_down {
            return;
        }
        let hwnd = *pending_hwnd;
        let mut rect = WinRect { left: 0, top: 0, right: 0, bottom: 0 };
        if unsafe { GetWindowRect(hwnd, &mut rect) } == 0 {
            return;
        }
        let origin_w = rect.right.saturating_sub(rect.left);
        let origin_h = rect.bottom.saturating_sub(rect.top);
        if origin_w <= 0 || origin_h <= 0 {
            return;
        }
        *drag = Some(NativeDrag {
            hwnd,
            origin_x: rect.left,
            origin_y: rect.top,
            origin_w,
            origin_h,
            grab_x: grab.x,
            grab_y: grab.y,
            start_dpi: monitor_dpi(hwnd),
        });
        *pending_hwnd = 0;
        emit("drag-armed");
        if apply_when_armed {
            DRAG_ACTIVE.store(true, Ordering::Relaxed);
            if let Some(active) = drag.as_ref() {
                place_drag(active);
            }
        }
    };
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
            if msg.message == WM_APP_CLICK {
                button_down = true;
                // GetCursorPos matches GetWindowRect. The hook point above is
                // only for the click report Electron already converts.
                if unsafe { GetCursorPos(&mut grab) } == 0 {
                    grab = WinPoint { x, y };
                }
                try_arm(&mut pending_hwnd, &grab, button_down, apply_when_armed, &mut drag);
            } else {
                button_down = false;
                pending_hwnd = 0;
                apply_when_armed = false;
                DRAG_ACTIVE.store(false, Ordering::Relaxed);
                drag = None;
            }
            continue;
        }
        if msg.message == WM_APP_DRAG_START {
            pending_hwnd = msg.wparam as isize;
            try_arm(&mut pending_hwnd, &grab, button_down, apply_when_armed, &mut drag);
            continue;
        }
        if msg.message == WM_APP_DRAG_ON {
            apply_when_armed = true;
            if drag.is_some() {
                DRAG_ACTIVE.store(true, Ordering::Relaxed);
                if let Some(active) = drag.as_ref() {
                    place_drag(active);
                }
            }
            continue;
        }
        if msg.message == WM_APP_DRAG_END {
            pending_hwnd = 0;
            apply_when_armed = false;
            DRAG_ACTIVE.store(false, Ordering::Relaxed);
            drag = None;
            continue;
        }
        if msg.message == WM_APP_MOVE && DRAG_ACTIVE.load(Ordering::Relaxed) {
            if let Some(active) = drag.as_ref() {
                place_drag(active);
            }
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

fn enable_per_monitor_dpi() {
    // Electron is per-monitor aware. Match it so GetCursorPos, GetWindowRect,
    // and SetWindowPos share one physical pixel space. Low-level hook points
    // are already physical, which is what the click report converts.
    unsafe {
        if SetProcessDpiAwarenessContext(-4) == 0 {
            SetProcessDPIAware();
        }
    }
}

fn main() {
    enable_per_monitor_dpi();
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
