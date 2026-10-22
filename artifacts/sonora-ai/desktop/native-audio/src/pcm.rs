use anyhow::{bail, Result};

use crate::echo::Canceller;

pub const RATE: u32 = 16_000;
const SAMPLES: usize = RATE as usize * 9 / 2;
/// Below this, a chunk is silence. Above it, quiet speech is lifted toward the target.
const SPEECH_FLOOR: f32 = 0.003;
const TARGET_PEAK: f32 = 0.2;
const MAX_GAIN: f32 = 8.0;

pub const FRAME: usize = 160;

pub enum Chunk {
    Audio(Vec<u8>, bool),
    /// 10 ms of mono 16 kHz PCM, little-endian. Sent while speech is still going.
    Pcm(Vec<u8>),
    Silence { prolonged: bool },
}

/// At most 4.5 seconds. A finished phrase is sent once 0.7 seconds of quiet follows at least one second of audio.
pub struct Encoder {
    rate: Option<u32>,
    phase: u32,
    sum: f64,
    count: u32,
    samples: Vec<i16>,
    live: Vec<i16>,
    reference_rate: Option<u32>,
    reference_phase: u32,
    reference_sum: f64,
    reference_count: u32,
    echo: Canceller,
    peak: f32,
    silent_chunks: u32,
    trailing_quiet: usize,
}

impl Encoder {
    pub fn new() -> Self {
        Self {
            rate: None,
            phase: 0,
            sum: 0.0,
            count: 0,
            samples: Vec::with_capacity(SAMPLES),
            live: Vec::with_capacity(FRAME),
            reference_rate: None,
            reference_phase: 0,
            reference_sum: 0.0,
            reference_count: 0,
            echo: Canceller::new(),
            peak: 0.0,
            silent_chunks: 0,
            trailing_quiet: 0,
        }
    }

    /// Loopback can stop delivering buffers when no app is playing sound.
    /// Finish partial speech chunks on the same wall-clock cadence, without
    /// claiming the device itself is producing samples.
    pub fn pad_silence(&mut self, milliseconds: u32) -> Result<Vec<Chunk>> {
        if milliseconds > 250 {
            bail!("Silence padding exceeded its bounded interval.");
        }
        match self.rate {
            Some(rate) => self.push(rate, &vec![0.0; (u64::from(rate) * u64::from(milliseconds) / 1000) as usize]),
            None => Ok(Vec::new()),
        }
    }

    /// Meeting playback used only to remove speaker echo from the microphone.
    pub fn push_reference(&mut self, rate: u32, input: &[f32]) -> Result<()> {
        if !(RATE..=384_000).contains(&rate) {
            bail!("Unsupported audio sample rate. Select another device.");
        }
        if self.reference_rate.is_some_and(|previous| previous != rate) {
            bail!("Audio device format changed. Stop and restart capture.");
        }
        self.reference_rate = Some(rate);
        for &value in input {
            if !value.is_finite() {
                bail!("Audio device returned invalid samples.");
            }
            self.reference_sum += f64::from(value.clamp(-1.0, 1.0));
            self.reference_count += 1;
            self.reference_phase += RATE;
            if self.reference_phase < rate {
                continue;
            }
            self.reference_phase -= rate;
            let sample = (self.reference_sum / f64::from(self.reference_count)) as f32;
            self.reference_sum = 0.0;
            self.reference_count = 0;
            self.echo.push_reference(sample);
        }
        Ok(())
    }

    pub fn push(&mut self, rate: u32, input: &[f32]) -> Result<Vec<Chunk>> {
        if !(RATE..=384_000).contains(&rate) {
            bail!("Unsupported audio sample rate. Select another device.");
        }
        if self.rate.is_some_and(|previous| previous != rate) {
            bail!("Audio device format changed. Stop and restart capture.");
        }
        self.rate = Some(rate);
        let mut chunks = Vec::new();
        for &value in input {
            if !value.is_finite() {
                bail!("Audio device returned invalid samples.");
            }
            self.sum += f64::from(value.clamp(-1.0, 1.0));
            self.count += 1;
            self.phase += RATE;
            if self.phase < rate {
                continue;
            }
            self.phase -= rate;
            let mixed = (self.sum / f64::from(self.count)) as f32;
            self.sum = 0.0;
            self.count = 0;
            let sample = self.echo.process(mixed);
            self.peak = self.peak.max(sample.abs());
            self.trailing_quiet = if sample.abs() < 0.003 { self.trailing_quiet + 1 } else { 0 };
            let pcm = (sample * 32767.0).round() as i16;
            self.live.push(pcm);
            if self.live.len() == FRAME {
                let mut frame = std::mem::take(&mut self.live);
                let frame_peak = frame.iter().fold(0.0_f32, |peak, sample| peak.max(f32::from(sample.unsigned_abs()) / 32767.0));
                if frame_peak >= SPEECH_FLOOR {
                    lift_quiet_speech(&mut frame, frame_peak);
                }
                chunks.push(Chunk::Pcm(pcm_bytes(&frame)));
            }
            self.samples.push(pcm);
            let turn_ready = self.samples.len() >= RATE as usize
                && self.trailing_quiet >= RATE as usize * 7 / 10
                && self.peak >= SPEECH_FLOOR;
            if self.samples.len() != SAMPLES && !turn_ready {
                continue;
            }
            if self.peak < SPEECH_FLOOR {
                self.silent_chunks += 1;
                chunks.push(Chunk::Silence {
                    prolonged: self.silent_chunks >= 4,
                });
            } else {
                self.silent_chunks = 0;
                lift_quiet_speech(&mut self.samples, self.peak);
                chunks.push(Chunk::Audio(wav(&self.samples), self.trailing_quiet >= RATE as usize * 7 / 10));
            }
            self.samples.clear();
            self.peak = 0.0;
        }
        Ok(chunks)
    }
}

/// Raise a quiet-but-real chunk toward a usable level. Silence never reaches here.
fn pcm_bytes(samples: &[i16]) -> Vec<u8> {
    let mut output = Vec::with_capacity(samples.len() * 2);
    for sample in samples {
        output.extend_from_slice(&sample.to_le_bytes());
    }
    output
}

fn lift_quiet_speech(samples: &mut [i16], peak: f32) {
    if peak >= TARGET_PEAK {
        return;
    }
    let gain = (TARGET_PEAK / peak).min(MAX_GAIN);
    for sample in samples {
        let boosted = (f32::from(*sample) * gain).round().clamp(-32767.0, 32767.0);
        *sample = boosted as i16;
    }
}

fn wav(samples: &[i16]) -> Vec<u8> {
    let bytes = (samples.len() * 2) as u32;
    let mut output = Vec::with_capacity(44 + bytes as usize);
    output.extend_from_slice(b"RIFF");
    output.extend_from_slice(&(36 + bytes).to_le_bytes());
    output.extend_from_slice(b"WAVEfmt ");
    output.extend_from_slice(&16u32.to_le_bytes());
    output.extend_from_slice(&1u16.to_le_bytes());
    output.extend_from_slice(&1u16.to_le_bytes());
    output.extend_from_slice(&RATE.to_le_bytes());
    output.extend_from_slice(&(RATE * 2).to_le_bytes());
    output.extend_from_slice(&2u16.to_le_bytes());
    output.extend_from_slice(&16u16.to_le_bytes());
    output.extend_from_slice(b"data");
    output.extend_from_slice(&bytes.to_le_bytes());
    for sample in samples {
        output.extend_from_slice(&sample.to_le_bytes());
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn resamples_and_encodes_independent_four_and_half_second_chunks() {
        for rate in [16_000, 44_100, 48_000, 96_000] {
            let mut encoder = Encoder::new();
            let chunks: Vec<_> = encoder.push(rate, &vec![0.25; rate as usize * 9]).unwrap()
                .into_iter().filter(|chunk| matches!(chunk, Chunk::Audio(_, _))).collect();
            assert_eq!(chunks.len(), 2);
            for chunk in chunks {
                let Chunk::Audio(wav, end_of_turn) = chunk else {
                    panic!("Expected WAV");
                };
                assert_eq!(wav.len(), 144_044);
                assert!(!end_of_turn);
                assert_eq!(&wav[0..4], b"RIFF");
                assert_eq!(&wav[8..16], b"WAVEfmt ");
                assert_eq!(u32::from_le_bytes(wav[24..28].try_into().unwrap()), RATE);
                assert_eq!(i16::from_le_bytes(wav[44..46].try_into().unwrap()), 8192);
            }
        }
    }
    #[test]
    fn silence_warns_and_format_changes_fail_explicitly() {
        let mut encoder = Encoder::new();
        let chunks: Vec<_> = encoder.push(48_000, &vec![0.0; 48_000 * 18]).unwrap()
            .into_iter().filter(|chunk| matches!(chunk, Chunk::Silence { .. })).collect();
        assert!(matches!(chunks[3], Chunk::Silence { prolonged: true }));
        assert!(encoder.push(44_100, &[0.1]).is_err());
        assert!(Encoder::new().push(8_000, &[0.1]).is_err());
        assert!(Encoder::new().push(48_000, &[f32::NAN]).is_err());
    }
    #[test]
    fn idle_loopback_finishes_short_speech_then_remains_silent() {
        let mut encoder = Encoder::new();
        assert!(encoder.pad_silence(250).unwrap().is_empty());
        assert!(encoder.push(48_000, &vec![0.2; 48_000 * 2]).unwrap().iter().all(|chunk| matches!(chunk, Chunk::Pcm(_))));
        let mut chunks = Vec::new();
        for _ in 0..10 { chunks.extend(encoder.pad_silence(250).unwrap()); }
        chunks.retain(|chunk| matches!(chunk, Chunk::Audio(_, _)));
        assert_eq!(chunks.len(), 1);
        let Chunk::Audio(wav, end_of_turn) = &chunks[0] else { panic!("Short speech was lost"); };
        assert_eq!(wav.len(), 86_444);
        assert!(*end_of_turn);
        assert!(wav[44..64044].iter().any(|x| *x != 0));
        assert!(wav[64044..].iter().all(|x| *x == 0));
        let mut silent = Vec::new();
        for _ in 0..24 { silent.extend(encoder.pad_silence(250).unwrap()); }
        silent.retain(|chunk| matches!(chunk, Chunk::Silence { .. }));
        assert!(matches!(silent[0], Chunk::Silence { .. }));
        assert!(encoder.pad_silence(251).is_err());
        assert!(encoder.push(48_000, &[0.1; 480]).is_ok());
    }
    #[test]
    fn quiet_speech_is_lifted_and_near_silence_is_not() {
        let mut encoder = Encoder::new();
        let chunks: Vec<_> = encoder.push(16_000, &vec![0.01; SAMPLES]).unwrap()
            .into_iter().filter(|chunk| matches!(chunk, Chunk::Audio(_, _))).collect();
        let Chunk::Audio(wav, _) = &chunks[0] else { panic!("Quiet speech was dropped"); };
        // 0.01 quantizes to 328, then the 8x cap lifts it to 2624.
        assert_eq!(i16::from_le_bytes(wav[44..46].try_into().unwrap()), 2624);
        let silent: Vec<_> = Encoder::new().push(16_000, &vec![0.001; SAMPLES]).unwrap()
            .into_iter().filter(|chunk| matches!(chunk, Chunk::Silence { .. })).collect();
        assert!(matches!(silent[0], Chunk::Silence { prolonged: false }));
    }
}
