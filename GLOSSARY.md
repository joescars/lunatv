# Glossary

**Hardware accelerator**
The GPU vendor stack that encodes, and optionally decodes, live and recorded video: Intel Quick Sync (`qsv`) or NVIDIA (`nvidia`). One per server; every transcode uses it.
_Avoid_: GPU mode, encoder type

**Decode mode**
Where the incoming tuner video is decoded before re-encoding: in software (`sw`) or on the hardware accelerator (`hw`). Software decode is what lets embedded captions survive. Independent of which hardware accelerator is chosen.
_Avoid_: using `qsv` as a decode mode (legacy spelling of `hw`)

**Direct**
A Roku-only stream mode that remuxes the tuner's raw video and audio into HLS without decoding or encoding. Neither the hardware accelerator nor the decode mode applies.
_Avoid_: passthrough, copy mode
