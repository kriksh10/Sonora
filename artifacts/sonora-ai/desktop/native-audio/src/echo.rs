use sonora::config::{EchoCanceller, TransparentModeType};
use sonora::{AudioProcessing, Config, StreamConfig};
use std::collections::VecDeque;

const TAPS: usize = 1_600;
const FRAME: usize = 160;
const MIC_DELAY: usize = 1_280;
const REFERENCE_SILENCE: usize = 32_000;

/// Removes meeting playback from the microphone.
/// The public AEC3 library handles each 10 ms frame. The shorter filter covers
/// the same 80 ms delay when that frame is not yet quieter.
pub struct Canceller {
    audio: AudioProcessing,
    weights: Vec<f32>,
    history: Vec<f32>,
    pos: usize,
    filled: usize,
    pending: VecDeque<f32>,
    mic_delay: VecDeque<f32>,
    render: Vec<f32>,
    capture: Vec<f32>,
    output: VecDeque<f32>,
    quiet: usize,
    active: bool,
}

impl Canceller {
    pub fn new() -> Self {
        let mut audio = AudioProcessing::builder()
            .config(Config {
                echo_canceller: Some(EchoCanceller {
                    enforce_high_pass_filtering: true,
                    transparent_mode: TransparentModeType::Hmm,
                }),
                ..Config::default()
            })
            .capture_config(StreamConfig::new(16_000, 1))
            .render_config(StreamConfig::new(16_000, 1))
            .build();
        let _ = audio.set_stream_delay_ms(80);
        Self {
            audio,
            weights: vec![0.0; TAPS],
            history: vec![0.0; TAPS],
            pos: 0,
            filled: 0,
            pending: VecDeque::new(),
            mic_delay: VecDeque::new(),
            render: Vec::new(),
            capture: Vec::new(),
            output: VecDeque::new(),
            quiet: 0,
            active: false,
        }
    }

    pub fn push_reference(&mut self, sample: f32) {
        let sample = sample.clamp(-1.0, 1.0);
        if sample.abs() < 0.003 {
            self.quiet = self.quiet.saturating_add(1);
        } else {
            self.quiet = 0;
            self.active = true;
        }
        if self.pending.len() >= 16_000 { self.pending.pop_front(); }
        self.pending.push_back(sample);
        self.render.push(sample);
        if self.render.len() > 16_000 {
            let extra = self.render.len() - 16_000;
            self.render.drain(..extra);
        }
    }

    pub fn process(&mut self, mic: f32) -> f32 {
        if !self.active { return mic; }
        if self.quiet >= REFERENCE_SILENCE { return mic; }
        let cleaned = self.adapt(mic);
        self.capture.push(cleaned);
        self.pump();
        self.output.pop_front().unwrap_or(cleaned)
    }

    fn adapt(&mut self, mic: f32) -> f32 {
        let Some(reference) = self.pending.pop_front() else { return mic; };
        self.mic_delay.push_back(mic);
        self.history[self.pos] = reference;
        self.pos = (self.pos + 1) % TAPS;
        self.filled = self.filled.saturating_add(1).min(TAPS);
        if self.mic_delay.len() <= MIC_DELAY || self.filled < TAPS { return mic; }
        let mic = self.mic_delay.pop_front().unwrap_or(mic);
        let mut echo = 0.0_f32;
        for (index, weight) in self.weights.iter().enumerate() {
            echo += weight * self.history[(self.pos + index) % TAPS];
        }
        let error = (mic - echo).clamp(-1.0, 1.0);
        let power = self.history.iter().map(|sample| sample * sample).sum::<f32>().max(1.0e-4);
        let step = (0.5 / power).min(2.0);
        for index in 0..TAPS {
            let sample = self.history[(self.pos + index) % TAPS];
            self.weights[index] += step * error * sample;
        }
        error
    }

    fn pump(&mut self) {
        while self.render.len() >= FRAME && self.capture.len() >= FRAME {
            let render: Vec<f32> = self.render.drain(..FRAME).collect();
            let capture: Vec<f32> = self.capture.drain(..FRAME).collect();
            let mut render_out = vec![0.0_f32; FRAME];
            let mut capture_out = vec![0.0_f32; FRAME];
            let rendered = self.audio.process_render_f32(&[&render], &mut [&mut render_out]);
            let cleaned = self.audio.process_capture_f32(&[&capture], &mut [&mut capture_out]);
            let capture_energy = energy(&capture);
            let library_energy = energy(&capture_out);
            let chosen = if rendered.is_ok() && cleaned.is_ok() && library_energy < capture_energy {
                capture_out
            } else {
                capture
            };
            self.output.extend(chosen);
        }
    }
}

fn energy(frame: &[f32]) -> f32 {
    frame.iter().map(|sample| sample * sample).sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn playback_copy_in_the_microphone_is_reduced() {
        let mut canceller = Canceller::new();
        let mut before = 0.0_f32;
        let mut after = 0.0_f32;
        for index in 0..24_000 {
            let reference = (index as f32 * 0.07).sin() * 0.4;
            canceller.push_reference(reference);
            let cleaned = canceller.process(reference);
            if index > 20_000 {
                before += reference * reference;
                after += cleaned * cleaned;
            }
        }
        assert!(after < before * 0.5, "echo energy {after} stayed near {before}");
    }

    #[test]
    fn quiet_playback_leaves_the_microphone_unchanged() {
        let mut canceller = Canceller::new();
        for _ in 0..200 {
            canceller.push_reference(0.4);
            let _ = canceller.process(0.0);
        }
        for index in 0..(REFERENCE_SILENCE + 20) {
            canceller.push_reference(0.0);
            let cleaned = canceller.process(0.2);
            if index > REFERENCE_SILENCE {
                assert!((cleaned - 0.2).abs() < 0.001, "quiet mic became {cleaned}");
            }
        }
    }
}
