# SpectrumCore melodic_contour_pitch_eac_4s Comparison Pack

Date: 2026-06-03
Fixture: `c:\projects\KKMindWave\SpectrumCore\cli\build\x64\melodic_contour_pitch_eac_4s.wav`
Fixture SHA256: `D087F9E7AA582F7871DADE0776DCBE59DB0E3616DBFD1834AEE1BE814BEF544A`

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
- Phase vs uphase representative-tile max abs delta: `31.415926`.

## Mode Verdicts

- `magnitude`: `match` - All fixture-specific magnitude checks passed against the stricter profile.
- `magnitude` primary `noteE5` -> frame `213`, bin `31`, `667.529297` Hz, value `0.056758`, magnitude `0.056758`.
- `magnitude` area peak -> frame `217`, bin `31`, `2.542585` s, `667.529297` Hz.
- `phase`: `match` - Wrapped-phase queries stay on the same canonical magnitude binding and value echoes the wrapped phase field.
- `phase` primary `noteE5` -> frame `213`, bin `31`, `667.529297` Hz, value `2.112026`, magnitude `0.056758`.
- `phase` area peak -> frame `217`, bin `31`, `2.542585` s, `667.529297` Hz.
- `uphase`: `match` - Unwrapped-phase queries stay on the same canonical magnitude binding and value echoes the unwrapped phase field.
- `uphase` primary `noteE5` -> frame `213`, bin `31`, `667.529297` Hz, value `-4.171159`, magnitude `0.056758`.
- `uphase` area peak -> frame `217`, bin `31`, `2.542585` s, `667.529297` Hz.

## Strict Checks

- Magnitude check count: `11`.
- Phase check count: `22`.
- Uphase check count: `23`.

## Reference Packs

- FFmpeg: `c:\projects\KKMindWave\GnauralCore\spectrum\research\ffmpeg\melodic_contour_pitch_eac_4s` (magnitude, phase, uphase rasters).
- Audacity: `c:\projects\KKMindWave\GnauralCore\spectrum\research\audacity\melodic_contour_pitch_eac_4s` (magnitude-style spectrogram reference only).
