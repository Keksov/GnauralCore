# SpectrumCore Comparison Packs

Date: 2026-06-03
Status: strict multi-mode SpectrumCore manifests generated for the current R5A fixture set

This directory now holds the SpectrumCore side of the shared parity set.
Each canonical R5A fixture pack now captures stricter fixture-specific magnitude checks plus full `phase` and `uphase` worker coverage.
Each canonical R5A fixture pack contains:

- `manifest.json`
- `README.md`
- `session-transcript.jsonl`
- `input-sha256.txt`

Archived top-level records:

- `reference-source-provenance-2026-06-04.md`
- `r5a-final-parity-baseline-2026-06-04.md`

Canonical R5A packs and current strict summary labels:

- `sine440_1s_mono_44k` - `match`
- `multitone_440_880_1760_2s` - `match`
- `chirp_20_8000_3s` - `match`
- `impulse_train_2s` - `match`
- `silence_1s` - `match`
- `melodic_contour_pitch_eac_4s` - `match`
- `transient_burst_reassignment_2s` - `match`

Reference pack roots:

- FFmpeg: `c:\projects\KKMindWave\GnauralCore\spectrum\research\ffmpeg` (magnitude, phase, uphase rasters)
- Audacity: `c:\projects\KKMindWave\GnauralCore\spectrum\research\audacity` (magnitude-style spectrogram captures)

Historical compatibility:

- `test_sine440` remains as the original pre-R5A special-case baseline.
- New automation should use `sine440_1s_mono_44k` as the canonical sine fixture pack and treat `test_sine440` as retained provenance only.