// Adapted from Meetily's Core Audio capture implementation, MIT licensed.
// Copyright (c) 2024 Zackriya Solutions. See ../THIRD_PARTY_NOTICES.txt.
use crate::platform::{Capture, Samples};
use anyhow::{bail, Result};
use cidre::{arc, av, cat, cf, core_audio as ca, os};
use ringbuf::{
    traits::{Consumer, Producer, Split},
    HeapCons, HeapProd, HeapRb,
};
use std::sync::{
    atomic::{AtomicBool, AtomicU32, Ordering},
    Arc,
};

struct Context {
    format: arc::R<av::AudioFormat>,
    producer: HeapProd<f32>,
    rate: Arc<AtomicU32>,
    overflow: Arc<AtomicBool>,
}
pub struct MacCapture {
    // Device must stop before callback context and tap are released.
    _device: ca::hardware::StartedDevice<ca::AggregateDevice>,
    _context: Box<Context>,
    _tap: ca::TapGuard,
    consumer: HeapCons<f32>,
    rate: Arc<AtomicU32>,
    overflow: Arc<AtomicBool>,
}
impl MacCapture {
    pub fn open() -> Result<Self> {
        let output = ca::System::default_output_device()
            .map_err(|error| anyhow::anyhow!("Core Audio output unavailable: {error:?}"))?;
        let output_uid = output.uid().map_err(|error| {
            anyhow::anyhow!("Core Audio output identity unavailable: {error:?}")
        })?;
        let tap = ca::TapDesc::with_mono_global_tap_excluding_processes(&cidre::ns::Array::new())
            .create_process_tap()
            .map_err(|error| anyhow::anyhow!("Core Audio permission or tap failed: {error:?}"))?;
        let tap_uid = tap
            .uid()
            .map_err(|error| anyhow::anyhow!("Core Audio tap identity failed: {error:?}"))?;
        let asbd = tap
            .asbd()
            .map_err(|error| anyhow::anyhow!("Core Audio tap format failed: {error:?}"))?;
        let format = av::AudioFormat::with_asbd(&asbd)
            .ok_or_else(|| anyhow::anyhow!("Core Audio returned an unsupported format."))?;
        if format.common_format() != av::audio::CommonFormat::PcmF32 {
            bail!("Core Audio requires floating-point PCM.");
        }
        let sub_tap = cf::DictionaryOf::with_keys_values(
            &[ca::sub_device_keys::uid()],
            &[tap_uid.as_type_ref()],
        );
        // Tap only: adding the output device as a sub-device duplicates system audio.
        let description = cf::DictionaryOf::with_keys_values(
            &[
                ca::aggregate_device_keys::is_private(),
                ca::aggregate_device_keys::is_stacked(),
                ca::aggregate_device_keys::tap_auto_start(),
                ca::aggregate_device_keys::name(),
                ca::aggregate_device_keys::main_sub_device(),
                ca::aggregate_device_keys::uid(),
                ca::aggregate_device_keys::tap_list(),
            ],
            &[
                cf::Boolean::value_true().as_type_ref(),
                cf::Boolean::value_false(),
                cf::Boolean::value_true(),
                cf::str!(c"sonora-audio-tap").as_type_ref(),
                &output_uid,
                &cf::Uuid::new().to_cf_string(),
                &cf::ArrayOf::from_slice(&[sub_tap.as_ref()]),
            ],
        );
        let (producer, consumer) = HeapRb::<f32>::new(131_072).split();
        let rate = Arc::new(AtomicU32::new(asbd.sample_rate as u32));
        let overflow = Arc::new(AtomicBool::new(false));
        let mut context = Box::new(Context {
            format,
            producer,
            rate: rate.clone(),
            overflow: overflow.clone(),
        });
        let device = ca::AggregateDevice::with_desc(&description)
            .map_err(|error| anyhow::anyhow!("Core Audio aggregate device failed: {error:?}"))?;
        let callback = device
            .create_io_proc_id(audio_proc, Some(context.as_mut()))
            .map_err(|error| anyhow::anyhow!("Core Audio callback setup failed: {error:?}"))?;
        let device = ca::device_start(device, Some(callback))
            .map_err(|error| anyhow::anyhow!("Core Audio device start failed: {error:?}"))?;
        Ok(Self {
            _device: device,
            _context: context,
            _tap: tap,
            consumer,
            rate,
            overflow,
        })
    }
}

extern "C" fn audio_proc(
    device: ca::Device,
    _now: &cat::AudioTimeStamp,
    input: &cat::AudioBufList<1>,
    _input_time: &cat::AudioTimeStamp,
    _output: &mut cat::AudioBufList<1>,
    _output_time: &cat::AudioTimeStamp,
    context: Option<&mut Context>,
) -> os::Status {
    let Some(context) = context else {
        return os::Status::NO_ERR;
    };
    if let Ok(rate) = device.nominal_sample_rate() {
        context.rate.store(rate as u32, Ordering::Release);
    }
    if let Some(view) = av::AudioPcmBuf::with_buf_list_no_copy(&context.format, input, None) {
        if let Some(data) = view.data_f32_at(0) {
            if context.producer.push_slice(data) != data.len() {
                context.overflow.store(true, Ordering::Release);
            }
        }
    } else {
        // Never silently continue if the device changes to an unsupported format.
        context.overflow.store(true, Ordering::Release);
    }
    os::Status::NO_ERR
}

impl Capture for MacCapture {
    fn read(&mut self) -> Result<Option<Samples>> {
        if self.overflow.load(Ordering::Acquire) {
            bail!("Core Audio stopped or its buffer overflowed. Restart capture.");
        }
        let data: Vec<f32> = (0..4096).map_while(|_| self.consumer.try_pop()).collect();
        if data.is_empty() {
            return Ok(None);
        }
        Ok(Some(Samples {
            rate: self.rate.load(Ordering::Acquire),
            data,
        }))
    }
}
