# Audacity Test Sine440 Capture Log

Date: 2026-06-03
Status: first live capture saved via `mod-script-pipe` and `PrintWindow`; gain mapping resolved by source plus live `Gain=1` comparison
Fixture: `c:\projects\KKMindWave\SpectrumCore\cli\build\x64\test_sine440.wav`
Fixture SHA256: `48EC56822558957D9922DAB94BA9F4324C66B9B24B6D4CED8F860B9B42CDC4DA`

## Runtime Status

- Live executable present at workspace-relative `SpectrumCore/lib/build/audacity-win64/install/bin/Audacity4.exe`; local runtime config reports version `4.0.0`.
- `mod-script-pipe` is enabled and both named pipes `\\.\pipe\ToSrvPipe` and `\\.\pipe\FromSrvPipe` are present after launch.
- Vendored `pipeclient.py` works on this localized install when run with `python -X utf8`.
- `Help: Command=Import2 Format=JSON`, `GetInfo: Type=Tracks Format=JSON`, and `SetTrack: Display=Spectrogram SpecPrefs=1 Height=300` all succeeded.
- `Help: Command=Screenshot Format=JSON` still returns `Command not found`, so the capture path uses Windows `PrintWindow` instead of a script-native screenshot command.

## Validated Configuration Workflow

Stage the legacy `/Spectrum/*` keys with `SetPreference` before launching the capture session:

- `MinFreq=80`
- `MaxFreq=4000`
- `Range=120`
- `Gain=0`
- `FrequencyGain=0`
- `FFTSize=2048`
- `WindowType=3`
- `Algorithm=0`
- `ScaleType=1`

Important runtime behavior:

- `SetPreference ... Reload=1` is not sufficient for this tuple. The reload path snaps the live values back to defaults (`ScaleType=2`, `MinFreq=1`, `MaxFreq=20000`, `Gain=20`, `Range=80`).
- A full Audacity process restart after staging the `/Spectrum/*` keys preserves the tuple in `audacity.cfg`.
- After restart, import the fixture with `Import2` and switch the selected track with `SetTrack: Display=Spectrogram SpecPrefs=1 Height=300`.
- The saved capture shows log-spaced ruler labels (`100, 150, 200, 300, 390, 500, 700, 1000, 2000, 3000`), which is consistent with the requested logarithmic scale.

## Mapping Note

- Current Audacity source maps modern `colorGainDb` directly to AU3 `settings->gain` and modern `colorRangeDb` directly to AU3 `settings->range`.
- The AU3 spectrogram painter normalizes non-pitch values as `(db + range + gain) / range`, so the top of the displayed color scale is `-Gain dB` and the floor is `-(Gain + Range) dB`.
- The target tuple's explicit `upper limit 0 dB` therefore maps to `/Spectrum/Gain=0` together with `/Spectrum/Range=120`.
- A second live comparison capture with staged `/Spectrum/Gain=1` produced a slightly brighter render over the same broad spectrogram ROI (`AvgLuma 0.387844 -> 0.390389`, `196898` changed ROI pixels), which is consistent with the same source formula.
- The earlier wording `gain: 1` is therefore treated as stale or inconsistent for the current Audacity semantics; for the parity target used here, `upper limit 0 dB` means legacy `Gain=0`.

## Captured Artifact

- `audacity-window-2026-06-03-printwindow.png`
- SHA256: `48A38B9A11D697F19B632F077B45A43FAD50B0CC9FF51DC85912A9DF88316CA9`
- `audacity-window-2026-06-03-gain1-printwindow.png`
- SHA256: `8E383D484E7C8D4876D0AC3BCB89BC58DB3D0CC71CCFDF80B8F7773BC321BCA8`
- Capture method: Windows `PrintWindow` against the Audacity main window handle.
- Saved under this folder.

## Observations

- The dominant tone appears as a stable bright horizontal band centered between the `390` and `500` Hz ruler marks for the full `0..1 s` duration.
- The `0.45..0.55 s` and `400..500 Hz` region contains a narrow cyan-white core at the dominant band, surrounded by orange-red energy.
- Strong vertical flares appear at the start and end boundaries (`0.00 s` and `1.00 s`), consistent with window-edge behavior.
- Above roughly `1.5 kHz`, the field is mostly dark with faint horizontal structure, while the low band below the tone stays warm/orange under the current `Gain=0` and `Range=120` settings.

## Comparison Anchor

Use the FFTW worker baseline in:
- `c:\projects\KKMindWave\GnauralCore\spectrum\research\comparison\test_sine440\baseline-2026-06-01.md`

Use the FFmpeg raster reference pack in:
- `c:\projects\KKMindWave\GnauralCore\spectrum\research\ffmpeg\test_sine440`
