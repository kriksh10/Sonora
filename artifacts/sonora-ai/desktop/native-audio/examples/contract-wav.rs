// Contract fixture: use the real encoder, not a separately reimplemented WAV.
#[path = "../src/pcm.rs"]
mod pcm;

use std::io::{self, Write};

fn main() -> anyhow::Result<()> {
    let mut encoder = pcm::Encoder::new();
    let chunks = encoder.push(48_000, &vec![0.2; 48_000 * 9 / 2])?;
    let pcm::Chunk::Audio(bytes, _) = &chunks[0] else {
        anyhow::bail!("Expected an audible WAV chunk");
    };
    io::stdout().write_all(bytes)?;
    Ok(())
}
