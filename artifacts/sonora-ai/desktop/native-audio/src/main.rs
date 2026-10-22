#[cfg(target_os = "macos")]
mod macos;
mod echo;
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
struct CaptureArgs {
    source: String,
    device: Option<String>,
    reference: Option<String>,
}

fn device_name(value: &str) -> Result<()> {
    if value.is_empty() || value.len() > 1024 || value.chars().any(char::is_control) {
        bail!("Usage: sonora-audio --source microphone|system");
    }
    Ok(())
}

fn parse_args(args: &[String]) -> Result<CaptureArgs> {
    if args.first().map(String::as_str) != Some("--source")
        || !matches!(args.get(1).map(String::as_str), Some("microphone" | "system"))
    {
        bail!("Usage: sonora-audio --source microphone|system");
    }
    let mut device = None;
    let mut reference = None;
    let mut index = 2;
    while index < args.len() {
        let value = args.get(index + 1).map(String::as_str).unwrap_or("");
        device_name(value)?;
        match args[index].as_str() {
            "--device-name" => device = Some(value.to_string()),
            "--reference-device" => reference = Some(value.to_string()),
            _ => bail!("Usage: sonora-audio --source microphone|system"),
        }
        index += 2;
    }
    if reference.is_some() && args[1] != "microphone" {
        bail!("Echo reference is only used with the microphone.");
    }
    if (device.is_some() || reference.is_some()) && !cfg!(target_os = "windows") {
        bail!("Audio device selection is supported on Windows only.");
    }
    Ok(CaptureArgs { source: args[1].clone(), device, reference })
}

fn run() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.len() == 2 && args[0] == "--list-devices"
        && matches!(args[1].as_str(), "microphone" | "system") {
        write_event(json!({ "devices": platform::devices(&args[1])? }))?;
        return Ok(());
    }
    let args = parse_args(&args)?;
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
    let mut capture = platform::open(&args.source, args.device.as_deref())?;
    let mut reference = match args.reference.as_deref() {
        Some(device) => Some(platform::open("system", Some(device))?),
        None if args.source == "microphone" => platform::open("system", None).ok(),
        None => None,
    };
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
        if let Some(reference) = reference.as_mut() {
            while let Some(samples) = reference.read()? {
                encoder.push_reference(samples.rate, &samples.data)?;
            }
        }
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
            if args.source == "microphone" && last_data.elapsed() > Duration::from_secs(30) {
                bail!("No audio samples received. Check OS audio permission and restart capture.");
            }
            thread::sleep(Duration::from_millis(5));
            if last_data.elapsed() > Duration::from_millis(150)
                && last_padding.elapsed() >= Duration::from_millis(50) {
                let ms = last_padding.elapsed().as_millis().min(250) as u32;
                last_padding = Instant::now();
                encoder.pad_silence(ms)?
            } else { Vec::new() }
        };
        for chunk in chunks {
            if stop.load(Ordering::Acquire) { break; }
            match chunk {
                pcm::Chunk::Audio(wav, end_of_turn) => write_event(json!({
                    "type": "audio", "audio": STANDARD.encode(wav), "endOfTurn": end_of_turn
                }))?,
                pcm::Chunk::Pcm(frame) => write_event(json!({
                    "type": "pcm", "audio": STANDARD.encode(frame)
                }))?,
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
    drop(reference);
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
