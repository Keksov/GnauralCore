# SpectrumCore silence_1s Comparison Pack

Date: 2026-06-03
Fixture: `c:\projects\KKMindWave\SpectrumCore\cli\build\x64\silence_1s.wav`
Fixture SHA256: `D25E833F369713F6A5B79ABC53EF7B0EDB9493D18EC92CCC56E9FD1748CDBABF`

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
- Phase vs uphase representative-tile max abs delta: `0.000000`.

## Mode Verdicts

- `magnitude`: `match` - All fixture-specific magnitude checks passed against the stricter profile.
- `magnitude` primary `silent440` -> frame `41`, bin `20`, `430.664063` Hz, value `0.000000`, magnitude `0.000000`.
- `magnitude` area peak -> frame `20`, bin `4`, `0.255419` s, `86.132813` Hz.
- `phase`: `match` - Wrapped-phase queries stay on the same canonical magnitude binding and value echoes the wrapped phase field.
- `phase` primary `silent440` -> frame `41`, bin `20`, `430.664063` Hz, value `0.000000`, magnitude `0.000000`.
- `phase` area peak -> frame `20`, bin `4`, `0.255419` s, `86.132813` Hz.
- `uphase`: `match` - Unwrapped-phase queries stay on the same canonical magnitude binding and value echoes the unwrapped phase field.
- `uphase` primary `silent440` -> frame `41`, bin `20`, `430.664063` Hz, value `0.000000`, magnitude `0.000000`.
- `uphase` area peak -> frame `20`, bin `4`, `0.255419` s, `86.132813` Hz.

## Strict Checks

- Magnitude check count: `3`.
- Phase check count: `18`.
- Uphase check count: `18`.

## Reference Packs

- FFmpeg: `c:\projects\KKMindWave\GnauralCore\spectrum\research\ffmpeg\silence_1s` (magnitude, phase, uphase rasters).
- Audacity: `c:\projects\KKMindWave\GnauralCore\spectrum\research\audacity\silence_1s` (magnitude-style spectrogram reference only).
