#[cfg(target_os = "macos")]
mod macos;
mod pcm;
mod platform;

use anyhow::{bail, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::json;
use std::{
    io::{self, BufRead, Write},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::{Duration, Instant},
};

fn write_event(value: serde_json::Value) -> Result<()> {
    let stdout = io::stdout();
    let mut output = stdout.lock();
    serde_json::to_writer(&mut output, &value)?;
    output.write_all(b"\n")?;
    output.flush()?;
    Ok(())
}
fn run() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.len() != 2
        || args[0] != "--source"
        || !matches!(args[1].as_str(), "microphone" | "system")
    {
        bail!("Usage: sonora-audio --source microphone|system");
    }
    // Parent pipe EOF stops capture even if the Electron process crashes.
    let stop = Arc::new(AtomicBool::new(false));
    let stdin_stop = stop.clone();
    thread::spawn(move || {
        let mut line = String::new();
        let _ = io::stdin().lock().read_line(&mut line);
        stdin_stop.store(true, Ordering::Release);
    });
    if stop.load(Ordering::Acquire) {
        return Ok(());
    }
    let mut capture = platform::open(&args[1])?;
    if stop.load(Ordering::Acquire) {
        return Ok(());
    }
    write_event(json!({ "type": "ready", "protocol": 2 }))?;
    let mut encoder = pcm::Encoder::new();
    let mut last_data = Instant::now();
    let mut last_status = Instant::now();
    let mut last_padding = Instant::now();
    let mut peak = 0.0_f32;
    while !stop.load(Ordering::Acquire) {
        let chunks = if let Some(samples) = capture.read()? {
            last_data = Instant::now();
            last_padding = last_data;
            peak = samples.data.iter().filter(|x| x.is_finite())
                .fold(peak, |p, x| p.max(x.abs().min(1.0)));
            encoder.push(samples.rate, &samples.data)?
        } else {
            // WASAPI loopback legitimately yields no buffers while the output is idle.
            // Microphones should continue producing samples; device errors still propagate
            // from read() for either source.
            if args[1] == "microphone" && last_data.elapsed() > Duration::from_secs(30) {
                bail!("No audio samples received. Check OS audio permission and restart capture.");
            }
            thread::sleep(Duration::from_millis(5));
            if args[1] == "system" && last_data.elapsed() > Duration::from_millis(150)
                && last_padding.elapsed() >= Duration::from_millis(50) {
                let ms = last_padding.elapsed().as_millis().min(250) as u32;
                last_padding = Instant::now();
                encoder.pad_silence(ms)?
            } else { Vec::new() }
        };
        for chunk in chunks {
            if stop.load(Ordering::Acquire) { break; }
            match chunk {
                pcm::Chunk::Audio(wav) => write_event(json!({ "type": "audio", "audio": STANDARD.encode(wav) }))?,
                pcm::Chunk::Silence { prolonged } => write_event(json!({ "type": "silence", "prolonged": prolonged }))?,
            }
        }
        if last_status.elapsed() >= Duration::from_secs(1) {
            write_event(json!({
                "type": "status",
                "sampleAgeMs": last_data.elapsed().as_millis().min(86_400_000) as u64,
                "peak": peak
            }))?;
            last_status = Instant::now();
            peak = 0.0;
        }
    }
    drop(capture);
    write_event(json!({ "type": "stopped" }))?;
    Ok(())
}
fn main() {
    if let Err(error) = run() {
        let _ = write_event(json!({ "type": "error", "message": error.to_string() }));
        std::process::exit(1);
    }
}
