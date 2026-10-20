use anyhow::{bail, Result};

pub struct Samples {
    pub rate: u32,
    pub data: Vec<f32>,
}
pub trait Capture {
    fn read(&mut self) -> Result<Option<Samples>>;
}

pub fn devices(source: &str) -> Result<Vec<String>> {
    #[cfg(target_os = "windows")]
    { return cpal_backend::devices(source); }
    #[cfg(not(target_os = "windows"))]
    { let _ = source; bail!("Audio device selection is supported on Windows only."); }
}

pub fn open(source: &str, device_name: Option<&str>) -> Result<Box<dyn Capture>> {
    #[cfg(target_os = "macos")]
    if source == "system" {
        return Ok(Box::new(crate::macos::MacCapture::open()?));
    }
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    return cpal_backend::open(source, device_name);
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = (source, device_name);
        bail!("Native audio capture requires Windows or macOS.");
    }
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
mod cpal_backend {
    use super::*;
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    };

    struct CpalCapture {
        // Drop the stream before callback-owned state.
        _stream: cpal::Stream,
        receiver: mpsc::Receiver<Samples>,
        overflow: Arc<AtomicBool>,
        failed: Arc<Mutex<bool>>,
    }
    impl Capture for CpalCapture {
        fn read(&mut self) -> Result<Option<Samples>> {
            if self.overflow.load(Ordering::Acquire) {
                bail!("Native audio queue overflowed. Capture stopped instead of dropping speech.");
            }
            if *self.failed.lock().unwrap() {
                bail!("The audio device disconnected or stopped. Restart capture.");
            }
            match self.receiver.try_recv() {
                Ok(samples) => Ok(Some(samples)),
                Err(mpsc::TryRecvError::Empty) => Ok(None),
                Err(_) => bail!("Native audio input closed."),
            }
        }
    }

    pub fn devices(source: &str) -> Result<Vec<String>> {
        let host = cpal::default_host();
        let devices = if source == "system" { host.output_devices()? } else { host.input_devices()? };
        devices.take(100).map(|device| Ok(device.name()?)).collect()
    }

    pub fn open(source: &str, device_name: Option<&str>) -> Result<Box<dyn Capture>> {
        let host = cpal::default_host();
        let default_device = if source == "system" {
            host.default_output_device()
        } else {
            host.default_input_device()
        };
        let device = if let Some(name) = device_name {
            let devices = if source == "system" { host.output_devices()? } else { host.input_devices()? };
            let mut matches: Vec<_> = devices.filter(|device| device.name().ok().as_deref() == Some(name)).collect();
            if matches.len() != 1 {
                bail!("Selected audio device is unavailable or ambiguous. Refresh devices and choose the meeting output again.");
            }
            matches.remove(0)
        } else {
            default_device.ok_or_else(|| anyhow::anyhow!("No default audio device is available."))?
        };
        // CPAL's Windows WASAPI backend uses LOOPBACK for input on an output device.
        let supported = if source == "system" {
            device.default_output_config()?
        } else {
            device.default_input_config()?
        };
        let config: cpal::StreamConfig = supported.clone().into();
        let channels = usize::from(config.channels);
        if channels == 0 || channels > 32 {
            bail!("Unsupported audio channel layout.");
        }
        let rate = config.sample_rate.0;
        let (sender, receiver) = mpsc::sync_channel(128);
        let overflow = Arc::new(AtomicBool::new(false));
        let failed = Arc::new(Mutex::new(false));
        macro_rules! stream {
            ($sample:ty, $convert:expr) => {{
                let sender = sender.clone();
                let overflow = overflow.clone();
                let failed = failed.clone();
                device.build_input_stream(
                    &config,
                    move |data: &[$sample], _| {
                        // Microphone arrays may contain auxiliary channels: use the first two.
                        let data = data
                            .chunks_exact(channels)
                            .map(|frame| {
                                let first = ($convert)(frame[0]);
                                if channels > 1 {
                                    (first + ($convert)(frame[1])) * 0.5
                                } else {
                                    first
                                }
                            })
                            .collect();
                        if sender.try_send(Samples { rate, data }).is_err() {
                            overflow.store(true, Ordering::Release);
                        }
                    },
                    move |_| {
                        if let Ok(mut value) = failed.lock() {
                            *value = true;
                        }
                    },
                    None,
                )?
            }};
        }
        let stream = match supported.sample_format() {
            cpal::SampleFormat::F32 => stream!(f32, |x: f32| x),
            cpal::SampleFormat::I16 => stream!(i16, |x: i16| f32::from(x) / 32768.0),
            cpal::SampleFormat::U16 => stream!(u16, |x: u16| (f32::from(x) - 32768.0) / 32768.0),
            _ => bail!("Unsupported native audio sample format."),
        };
        stream.play()?;
        Ok(Box::new(CpalCapture {
            _stream: stream,
            receiver,
            overflow,
            failed,
        }))
    }
}
