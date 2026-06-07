# Audacity chirp_20_8000_3s Capture Log

Date: 2026-06-03
Status: capture saved via reusable mod-script-pipe session and PrintWindow
Fixture: `c:\projects\KKMindWave\SpectrumCore\cli\build\x64\chirp_20_8000_3s.wav`

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
- SHA256: `144C26F65FF35AA6054F3A4865A4AA2FDBC04E91C8795C201DABD1C2A64CE52E`

## Observations

- Imported track metadata is recorded in `capture-session.log`.
- The capture shows one continuous rising diagonal trace from the low-frequency floor toward the top of the visible range across `0..3 s`.
- The trajectory broadens at the low end and becomes narrower/brighter as it climbs, with the rest of the field staying comparatively dark.
- This pack fixes the runtime surface to real Audacity rather than inferred source semantics alone.
