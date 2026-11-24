# Hardware accelerator and decode mode are separate settings

Supporting NVIDIA as well as Intel QSV meant the old `STREAM_DECODE_MODE=sw|qsv` setting could no longer describe both the GPU vendor and where decoding runs. We split them: `HW_ACCEL=qsv|nvidia` chooses the vendor, and `STREAM_DECODE_MODE=sw|hw` chooses whether decoding runs on that GPU. `qsv` is still accepted as a legacy alias for `hw`. We rejected a single combined variable (`sw|qsv|nvidia`) because software decode is needed for captions to survive on every vendor, so users need to choose decode mode independently of the vendor. The server exits at startup on an unknown `HW_ACCEL` value. A typo would otherwise show up only as confusing encoder failures at playback time.

## Consequences

- Docker defaults to QSV (`/dev/dri`). NVIDIA hosts layer `docker-compose.nvidia.yml`, which resets the device mapping and reserves the GPU through nvidia-container-toolkit. The image stays the same because Jellyfin ffmpeg ships both QSV and NVENC.
