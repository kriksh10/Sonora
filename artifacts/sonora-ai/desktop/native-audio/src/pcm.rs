use anyhow::{bail, Result};

pub const RATE: u32 = 16_000;
const SAMPLES: usize = RATE as usize * 6;

pub enum Chunk {
    Audio(Vec<u8>),
    Silence { prolonged: bool },
}

/// Average downsampling; independent six-second mono 16-bit PCM WAVs.
pub struct Encoder {
    rate: Option<u32>,
    phase: u32,
    sum: f64,
    count: u32,
    samples: Vec<i16>,
    peak: f32,
    silent_chunks: u32,
}

impl Encoder {
    pub fn new() -> Self {
        Self {
            rate: None,
            phase: 0,
            sum: 0.0,
            count: 0,
            samples: Vec::with_capacity(SAMPLES),
            peak: 0.0,
            silent_chunks: 0,
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
            let sample = (self.sum / f64::from(self.count)) as f32;
            self.sum = 0.0;
            self.count = 0;
            self.peak = self.peak.max(sample.abs());
            self.samples.push((sample * 32767.0).round() as i16);
            if self.samples.len() != SAMPLES {
                continue;
            }
            if self.peak < 0.003 {
                self.silent_chunks += 1;
                chunks.push(Chunk::Silence {
                    prolonged: self.silent_chunks >= 3,
                });
            } else {
                self.silent_chunks = 0;
                chunks.push(Chunk::Audio(wav(&self.samples)));
            }
            self.samples.clear();
            self.peak = 0.0;
        }
        Ok(chunks)
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
    fn resamples_and_encodes_independent_six_second_chunks() {
        for rate in [16_000, 44_100, 48_000, 96_000] {
            let mut encoder = Encoder::new();
            let chunks = encoder.push(rate, &vec![0.25; rate as usize * 12]).unwrap();
            assert_eq!(chunks.len(), 2);
            for chunk in chunks {
                let Chunk::Audio(wav) = chunk else {
                    panic!("Expected WAV");
                };
                assert_eq!(wav.len(), 192_044);
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
        let chunks = encoder.push(48_000, &vec![0.0; 48_000 * 18]).unwrap();
        assert!(matches!(chunks[2], Chunk::Silence { prolonged: true }));
        assert!(encoder.push(44_100, &[0.1]).is_err());
        assert!(Encoder::new().push(8_000, &[0.1]).is_err());
        assert!(Encoder::new().push(48_000, &[f32::NAN]).is_err());
    }
    #[test]
    fn idle_loopback_finishes_short_speech_then_remains_silent() {
        let mut encoder = Encoder::new();
        assert!(encoder.pad_silence(250).unwrap().is_empty());
        assert!(encoder.push(48_000, &vec![0.2; 48_000 * 2]).unwrap().is_empty());
        let mut chunks = Vec::new();
        for _ in 0..16 { chunks.extend(encoder.pad_silence(250).unwrap()); }
        assert_eq!(chunks.len(), 1);
        let Chunk::Audio(wav) = &chunks[0] else { panic!("Short speech was lost"); };
        assert_eq!(wav.len(), 192_044);
        assert!(wav[44..64044].iter().any(|x| *x != 0));
        assert!(wav[64044..].iter().all(|x| *x == 0));
        let mut silent = Vec::new();
        for _ in 0..24 { silent.extend(encoder.pad_silence(250).unwrap()); }
        assert!(matches!(silent[0], Chunk::Silence { .. }));
        assert!(encoder.pad_silence(251).is_err());
        assert!(encoder.push(48_000, &[0.1; 480]).is_ok());
    }
}
