# SpectrumCore sine440_1s_mono_44k Comparison Pack

Date: 2026-06-03
Fixture: `c:\projects\KKMindWave\SpectrumCore\cli\build\x64\sine440_1s_mono_44k.wav`
Fixture SHA256: `48EC56822558957D9922DAB94BA9F4324C66B9B24B6D4CED8F860B9B42CDC4DA`

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
- Phase vs uphase representative-tile max abs delta: `31.415929`.

## Mode Verdicts

- `magnitude`: `match` - All fixture-specific magnitude checks passed against the stricter profile.
- `magnitude` primary `tone440` -> frame `41`, bin `20`, `430.664063` Hz, value `0.442239`, magnitude `0.442239`.
- `magnitude` area peak -> frame `44`, bin `20`, `0.534059` s, `430.664063` Hz.
- `phase`: `match` - Wrapped-phase queries stay on the same canonical magnitude binding and value echoes the wrapped phase field.
- `phase` primary `tone440` -> frame `41`, bin `20`, `430.664063` Hz, value `2.580945`, magnitude `0.442239`.
- `phase` area peak -> frame `44`, bin `20`, `0.534059` s, `430.664063` Hz.
- `uphase`: `match` - Unwrapped-phase queries stay on the same canonical magnitude binding and value echoes the unwrapped phase field.
- `uphase` primary `tone440` -> frame `41`, bin `20`, `430.664063` Hz, value `2.580945`, magnitude `0.442239`.
- `uphase` area peak -> frame `44`, bin `20`, `0.534059` s, `430.664063` Hz.

## Strict Checks

- Magnitude check count: `5`.
- Phase check count: `10`.
- Uphase check count: `11`.

## Reference Packs

- FFmpeg: `c:\projects\KKMindWave\GnauralCore\spectrum\research\ffmpeg\sine440_1s_mono_44k` (magnitude, phase, uphase rasters).
- Audacity: `c:\projects\KKMindWave\GnauralCore\spectrum\research\audacity\sine440_1s_mono_44k` (magnitude-style spectrogram reference only).

## Historical Mapping

- This is the canonical normalized R5A replacement for the older `comparison\test_sine440` special-case pack.
- The historical baseline is retained for provenance, but new automation should treat this directory as the canonical sine fixture pack.
