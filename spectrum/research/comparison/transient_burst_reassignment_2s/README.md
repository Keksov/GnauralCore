# SpectrumCore transient_burst_reassignment_2s Comparison Pack

Date: 2026-06-03
Fixture: `c:\projects\KKMindWave\SpectrumCore\cli\build\x64\transient_burst_reassignment_2s.wav`
Fixture SHA256: `957D415035ED94D244D9FAE4AC58F19F2D30A75D7AECD51F67C6505E6E13433A`

## Runtime

- Worker: `c:\projects\KKMindWave\SpectrumCore\cli\build\x64\SpectrumCoreFftwWorkerProbe.exe`
- Worker SHA256: `138389703ECE09DAA5992339518CF639A2445F5378E6D03A2F4029E1D96219A7`
- Analysis tuple: `window=2048`, `hop=512`, `overlap=0.75`, `win_func=hann`, `data={magnitude,phase,uphase}`, `fscale=log`, `start=80`, `stop=4000`, `gain=1`, `drange=120`, `limit=0`.

## Saved Artifacts

- `manifest.json`
- `session-transcript.jsonl`
- `input-sha256.txt`

## Summary Classification

- Status: `match`
- Reason: All strict magnitude, phase, and unwrapped-phase checks passed.
- Phase vs uphase representative-tile max abs delta: `515.221203`.

## Mode Verdicts

- `magnitude`: `match` - All fixture-specific magnitude checks passed against the stricter profile.
- `magnitude` primary `on700` -> frame `42`, bin `33`, `710.595703` Hz, value `0.157316`, magnitude `0.157316`.
- `magnitude` area peak -> frame `42`, bin `32`, `0.510839` s, `689.062500` Hz.
- `phase`: `match` - Wrapped-phase queries stay on the same canonical magnitude binding and value echoes the wrapped phase field.
- `phase` primary `on700` -> frame `42`, bin `33`, `710.595703` Hz, value `-1.119506`, magnitude `0.157316`.
- `phase` area peak -> frame `42`, bin `32`, `0.510839` s, `689.062500` Hz.
- `uphase`: `match` - Unwrapped-phase queries stay on the same canonical magnitude binding and value echoes the unwrapped phase field.
- `uphase` primary `on700` -> frame `42`, bin `33`, `710.595703` Hz, value `-51.384987`, magnitude `0.157316`.
- `uphase` area peak -> frame `42`, bin `32`, `0.510839` s, `689.062500` Hz.

## Strict Checks

- Magnitude check count: `9`.
- Phase check count: `30`.
- Uphase check count: `31`.

## Reference Packs

- FFmpeg: `c:\projects\KKMindWave\GnauralCore\spectrum\research\ffmpeg\transient_burst_reassignment_2s` (magnitude, phase, uphase rasters).
- Audacity: `c:\projects\KKMindWave\GnauralCore\spectrum\research\audacity\transient_burst_reassignment_2s` (magnitude-style spectrogram reference only).
