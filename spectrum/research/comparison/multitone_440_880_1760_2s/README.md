# SpectrumCore multitone_440_880_1760_2s Comparison Pack

Date: 2026-06-03
Fixture: `c:\projects\KKMindWave\SpectrumCore\cli\build\x64\multitone_440_880_1760_2s.wav`
Fixture SHA256: `975CC9491E1DD9A8FEA81BBC9301BE1FA889D220C915E3DF8A0CDF7FABEA21D0`

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
- Phase vs uphase representative-tile max abs delta: `25.132740`.

## Mode Verdicts

- `magnitude`: `match` - All fixture-specific magnitude checks passed against the stricter profile.
- `magnitude` primary `tone880` -> frame `84`, bin `41`, `882.861328` Hz, value `0.061779`, magnitude `0.061779`.
- `magnitude` area peak -> frame `86`, bin `41`, `1.021678` s, `882.861328` Hz.
- `phase`: `match` - Wrapped-phase queries stay on the same canonical magnitude binding and value echoes the wrapped phase field.
- `phase` primary `tone880` -> frame `84`, bin `41`, `882.861328` Hz, value `-0.671831`, magnitude `0.061779`.
- `phase` area peak -> frame `86`, bin `41`, `1.021678` s, `882.861328` Hz.
- `uphase`: `match` - Unwrapped-phase queries stay on the same canonical magnitude binding and value echoes the unwrapped phase field.
- `uphase` primary `tone880` -> frame `84`, bin `41`, `882.861328` Hz, value `5.611354`, magnitude `0.061779`.
- `uphase` area peak -> frame `86`, bin `41`, `1.021678` s, `882.861328` Hz.

## Strict Checks

- Magnitude check count: `9`.
- Phase check count: `18`.
- Uphase check count: `19`.

## Reference Packs

- FFmpeg: `c:\projects\KKMindWave\GnauralCore\spectrum\research\ffmpeg\multitone_440_880_1760_2s` (magnitude, phase, uphase rasters).
- Audacity: `c:\projects\KKMindWave\GnauralCore\spectrum\research\audacity\multitone_440_880_1760_2s` (magnitude-style spectrogram reference only).
