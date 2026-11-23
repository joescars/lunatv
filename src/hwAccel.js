// Hardware accelerator (HW_ACCEL) and decode mode (STREAM_DECODE_MODE) are
// separate settings - see docs/adr/0001. Everything vendor-specific about an
// ffmpeg transcode lives here so stream.js and recordingStream.js stay
// vendor-neutral.

const DEFAULT_HW_ACCEL = 'qsv';

const ACCELERATORS = {
  qsv: {
    label: 'Intel Quick Sync (QSV)',
    encoders: { h264: 'h264_qsv', hevc: 'hevc_qsv' },
    encoderArgs: ['-look_ahead', '0', '-forced_idr', '1'],
    sw: {
      decoder: 'auto_software',
      // QSV encoders need the frames uploaded to a QSV device.
      inputArgs: ['-init_hw_device', 'qsv=hw', '-filter_hw_device', 'hw'],
      preEncodeArgs: ['-vf', 'format=nv12,hwupload=extra_hw_frames=64'],
    },
    hw: {
      // No forced -c:v: -hwaccel qsv picks the matching *_qsv decoder for
      // whatever the channel carries (MPEG-2, H.264, HEVC).
      decoder: 'auto_qsv',
      inputArgs: ['-hwaccel', 'qsv', '-hwaccel_output_format', 'qsv'],
      preEncodeArgs: [],
    },
    // hevc_qsv has no -a53cc option at all.
    captionCodecs: ['h264'],
    // Confirmed: QSV hardware decode drops A/53 CC data before the encoder.
    hwDecodeCaptions: false,
  },
  nvidia: {
    label: 'NVIDIA NVENC',
    encoders: { h264: 'h264_nvenc', hevc: 'hevc_nvenc' },
    encoderArgs: ['-preset', 'p4', '-tune', 'll', '-rc-lookahead', '0', '-forced-idr', '1'],
    sw: {
      decoder: 'auto_software',
      // NVENC reads system-memory frames directly; no device init or upload.
      inputArgs: [],
      preEncodeArgs: ['-vf', 'format=nv12'],
    },
    hw: {
      decoder: 'auto_cuda',
      inputArgs: ['-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda'],
      preEncodeArgs: [],
    },
    captionCodecs: ['h264', 'hevc'],
    // Unverified: -hwaccel cuda keeps ffmpeg's native decoder, which may carry
    // A/53 CC through. Reported as unknown until confirmed on hardware.
    hwDecodeCaptions: null,
  },
};

const HW_ACCELS = Object.keys(ACCELERATORS);

class HwAccelConfigError extends Error {
  constructor(value) {
    super(`Invalid HW_ACCEL "${value}". Supported values: ${HW_ACCELS.join(', ')}.`);
    this.name = 'HwAccelConfigError';
  }
}

function resolveHwAccel(env = process.env) {
  const raw = env.HW_ACCEL;
  if (raw === undefined || String(raw).trim() === '') return DEFAULT_HW_ACCEL;
  const value = String(raw).trim().toLowerCase();
  if (!ACCELERATORS[value]) throw new HwAccelConfigError(raw);
  return value;
}

// `qsv` is the legacy spelling of `hw` from before NVIDIA support.
function resolveDecodeMode(env = process.env) {
  const value = String(env.STREAM_DECODE_MODE || env.CAPTION_DECODE_MODE || 'sw').trim().toLowerCase();
  return value === 'hw' || value === 'qsv' ? 'hw' : 'sw';
}

function getAccelerator(env = process.env) {
  const name = resolveHwAccel(env);
  return { name, ...ACCELERATORS[name] };
}

// One-line summary for the startup log and the admin status page.
function describeTranscoding(env = process.env) {
  const accel = getAccelerator(env);
  const decodeMode = resolveDecodeMode(env);
  return {
    hwAccel: accel.name,
    label: accel.label,
    decodeMode,
    decoder: accel[decodeMode].decoder,
    encoders: { ...accel.encoders },
    summary: `${accel.label} encode, ${decodeMode === 'hw' ? 'hardware' : 'software'} decode`,
  };
}

module.exports = {
  DEFAULT_HW_ACCEL,
  HW_ACCELS,
  HwAccelConfigError,
  resolveHwAccel,
  resolveDecodeMode,
  getAccelerator,
  describeTranscoding,
};
