# Audacity melodic_contour_pitch_eac_4s Capture Log

Date: 2026-06-03
Status: capture saved via reusable mod-script-pipe session and PrintWindow
Fixture: `c:\projects\KKMindWave\SpectrumCore\cli\build\x64\melodic_contour_pitch_eac_4s.wav`

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
- SHA256: `EC573B5FD425BA43DC03DD654E3DB930750180F7D86462F4367F1683D132F8C9`

## Observations

- Imported track metadata is recorded in `capture-session.log`.
- The capture shows a stepped sequence of stable horizontal plateaus, with clear upward jumps at roughly the `1 s`, `2 s`, and `3 s` boundaries.
- Each pitch transition includes a narrow vertical flare before the next steady band settles.
- This pack fixes the runtime surface to real Audacity rather than inferred source semantics alone.
