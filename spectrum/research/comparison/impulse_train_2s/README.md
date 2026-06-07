# SpectrumCore impulse_train_2s Comparison Pack

Date: 2026-06-03
Fixture: `c:\projects\KKMindWave\SpectrumCore\cli\build\x64\impulse_train_2s.wav`
Fixture SHA256: `116149B2F1265A950238D12E9493CE3A30C4A9337ECD64C6E0320766FCFD034E`

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
- Phase vs uphase representative-tile max abs delta: `565.486690`.

## Mode Verdicts

- `magnitude`: `match` - All fixture-specific magnitude checks passed against the stricter profile.
- `magnitude` primary `on1000` -> frame `41`, bin `46`, `990.527344` Hz, value `0.000925`, magnitude `0.000925`.
- `magnitude` area peak -> frame `41`, bin `5`, `0.499229` s, `107.666016` Hz.
- `phase`: `match` - Wrapped-phase queries stay on the same canonical magnitude binding and value echoes the wrapped phase field.
- `phase` primary `on1000` -> frame `41`, bin `46`, `990.527344` Hz, value `1.484893`, magnitude `0.000925`.
- `phase` area peak -> frame `41`, bin `5`, `0.499229` s, `107.666016` Hz.
- `uphase`: `match` - Unwrapped-phase queries stay on the same canonical magnitude binding and value echoes the unwrapped phase field.
- `uphase` primary `on1000` -> frame `41`, bin `46`, `990.527344` Hz, value `139.714966`, magnitude `0.000925`.
- `uphase` area peak -> frame `41`, bin `5`, `0.499229` s, `107.666016` Hz.

## Strict Checks

- Magnitude check count: `9`.
- Phase check count: `30`.
- Uphase check count: `31`.

## Reference Packs

- FFmpeg: `c:\projects\KKMindWave\GnauralCore\spectrum\research\ffmpeg\impulse_train_2s` (magnitude, phase, uphase rasters).
- Audacity: `c:\projects\KKMindWave\GnauralCore\spectrum\research\audacity\impulse_train_2s` (magnitude-style spectrogram reference only).
