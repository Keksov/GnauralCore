# SpectrumCore chirp_20_8000_3s Comparison Pack

Date: 2026-06-03
Fixture: `c:\projects\KKMindWave\SpectrumCore\cli\build\x64\chirp_20_8000_3s.wav`
Fixture SHA256: `CF6917C511C63B32A28C0AB9B8E634333D23D560DF4FB989B650F73EF40A1329`

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
- Phase vs uphase representative-tile max abs delta: `18.849556`.

## Mode Verdicts

- `magnitude`: `match` - All fixture-specific magnitude checks passed against the stricter profile.
- `magnitude` primary `mid400` -> frame `127`, bin `19`, `409.130859` Hz, value `0.333281`, magnitude `0.333281`.
- `magnitude` area peak -> frame `121`, bin `16`, `1.428027` s, `344.531250` Hz.
- `phase`: `match` - Wrapped-phase queries stay on the same canonical magnitude binding and value echoes the wrapped phase field.
- `phase` primary `mid400` -> frame `127`, bin `19`, `409.130859` Hz, value `-2.396857`, magnitude `0.333281`.
- `phase` area peak -> frame `121`, bin `16`, `1.428027` s, `344.531250` Hz.
- `uphase`: `match` - Unwrapped-phase queries stay on the same canonical magnitude binding and value echoes the unwrapped phase field.
- `uphase` primary `mid400` -> frame `127`, bin `19`, `409.130859` Hz, value `-2.396857`, magnitude `0.333281`.
- `uphase` area peak -> frame `121`, bin `16`, `1.428027` s, `344.531250` Hz.

## Strict Checks

- Magnitude check count: `9`.
- Phase check count: `18`.
- Uphase check count: `19`.

## Reference Packs

- FFmpeg: `c:\projects\KKMindWave\GnauralCore\spectrum\research\ffmpeg\chirp_20_8000_3s` (magnitude, phase, uphase rasters).
- Audacity: `c:\projects\KKMindWave\GnauralCore\spectrum\research\audacity\chirp_20_8000_3s` (magnitude-style spectrogram reference only).
