# Audacity Reference Pack Index

Date: 2026-06-03
Status: reusable-session parity captures saved for the current R5A fixture set

## Runtime

- Executable (workspace-relative): `SpectrumCore/lib/build/audacity-win64/install/bin/Audacity4.exe`
- Runtime version from local config: `4.0.0`
- Scripting bridge: `mod-script-pipe` via `C:\Python313\python.exe -X utf8` and the vendored `pipeclient.py`
- Capture method: Windows `PrintWindow`
- Effective tuple: `MinFreq=80`, `MaxFreq=4000`, `Gain=0`, `Range=120`, `FrequencyGain=0`, `FFTSize=2048`, `WindowType=3`, `Algorithm=0`, `ScaleType=1`
- Session note: the current R5A packs were captured by reusing one restarted Audacity parity session through repeated `New + Import2 + SetTrack` cycles.

## Historical Pack

- `test_sine440` remains the original live-capture pack, including the separate `Gain=1` comparison screenshot used to close the gain-semantics question.

## Captured R5A Packs

- `sine440_1s_mono_44k`: one stable bright band near `440 Hz` for the full second, with edge flares at start and end.
- `multitone_440_880_1760_2s`: three persistent bright horizontal bands near `440`, `880`, and `1760 Hz` with clear separation between them.
- `chirp_20_8000_3s`: one continuous rising diagonal trajectory from the low-frequency floor toward the top of the visible range.
- `impulse_train_2s`: evenly spaced vertical broadband flares at roughly half-second intervals against a mostly dark background.
- `silence_1s`: uniformly dark field with no visible tonal bands or transient streaks.
- `melodic_contour_pitch_eac_4s`: stepped sequence of stable pitch plateaus with clear jumps at the one-second boundaries.
- `transient_burst_reassignment_2s`: repeated short burst columns with localized brighter zones in several fixed frequency bands.

Each fixture directory contains:

- `README.md`
- `input-sha256.txt`
- `capture-session.log`
- `audacity-window-2026-06-03-printwindow.png`

The shared session preflight log for the current run is saved as `audacity-session-preflight.log` at this folder root.