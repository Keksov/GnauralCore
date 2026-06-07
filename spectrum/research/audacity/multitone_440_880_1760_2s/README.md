# Audacity multitone_440_880_1760_2s Capture Log

Date: 2026-06-03
Status: capture saved via reusable mod-script-pipe session and PrintWindow
Fixture: `c:\projects\KKMindWave\SpectrumCore\cli\build\x64\multitone_440_880_1760_2s.wav`

## Runtime

- Executable (workspace-relative): `SpectrumCore/lib/build/audacity-win64/install/bin/Audacity4.exe`
- Local runtime config reports version `4.0.0`.
- Capture session preflight log saved in `..\audacity-session-preflight.log`.
- Fixture hash saved in `input-sha256.txt`.
- Full pipeclient transcript for this fixture saved in `capture-session.log`.

## Effective Spectrogram Tuple

- `MinFreq=80`
- `MaxFreq=4000`
- `Gain=0`
- `Range=120`
- `FrequencyGain=0`
- `FFTSize=2048`
- `WindowType=3`
- `Algorithm=0`
- `ScaleType=1`

## Capture Workflow

- This pack reuses one restarted Audacity parity session after the tuple was staged and activated.
- For this fixture the script executed `New`, `Import2`, `SelectTracks`, `SetTrack: Display=Spectrogram SpecPrefs=1 Height=300`, and `GetInfo: Type=Tracks Format=JSON` before the screenshot step.
- The saved artifact is a Windows `PrintWindow` capture of the Audacity main window.

## Captured Artifact

- `audacity-window-2026-06-03-printwindow.png`
- SHA256: `1B7DD07982E6E6F989CFE634F3B7E2F4341E83E0FAD956ECEB4C21FA76B258FF`

## Observations

- Imported track metadata is recorded in `capture-session.log`.
- Three persistent bright horizontal bands are visible near the `440`, `880`, and `1760` Hz regions for the full `0..2 s` window.
- The lowest band is the brightest, while the upper two bands remain clearly separated with darker gaps between them.
- This pack fixes the runtime surface to real Audacity rather than inferred source semantics alone.
