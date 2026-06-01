# Audacity Test Sine440 Capture Template

Date: 2026-06-01
Status: pending
Fixture: `c:\projects\KKMindWave\SpectrumCore\cli\build\x64\test_sine440.wav`

## Current Blocker

No `audacity` executable was found on `PATH` in the current environment during this session, so no live capture was produced here.

## Target Capture Tuple

Reproduce this exact settings tuple in Audacity before recording parity notes:

- window size: `2048`
- window function: `hann`
- scale: `logarithmic`
- minimum frequency: `80 Hz`
- maximum frequency: `4000 Hz`
- gain: `1`
- dynamic range: `120 dB`
- upper limit: `0 dB`
- baseline signal: mono sine around `440 Hz`

## Capture Checklist

Save these items into this folder when Audacity is available:

- one spectrogram screenshot or exported raster for the exact settings tuple
- Audacity build identifier and capture date
- source file SHA256
- at least three manual point observations around the dominant tone
- one area observation around `0.45..0.55 s` and `400..500 Hz`
- notes about visible leakage pattern and floor behavior

## Comparison Anchor

Use the FFTW worker baseline in:
- `c:\projects\KKMindWave\GnauralCore\spectrum\research\comparison\test_sine440\baseline-2026-06-01.md`

Use the FFmpeg raster reference pack in:
- `c:\projects\KKMindWave\GnauralCore\spectrum\research\ffmpeg\test_sine440`
