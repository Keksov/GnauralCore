# Audacity sine440_1s_mono_44k Capture Log

Date: 2026-06-03
Status: capture saved via reusable mod-script-pipe session and PrintWindow
Fixture: `c:\projects\KKMindWave\SpectrumCore\cli\build\x64\sine440_1s_mono_44k.wav`

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
- SHA256: `5061114588B6CE59CC26021FEE3A1B1963AD1658443F63A51B8D25000CD949FB`

## Observations

- Imported track metadata is recorded in `capture-session.log`.
- The capture shows one stable bright horizontal band centered between the `390` and `500` Hz ruler marks for the full `0..1 s` duration.
- Strong vertical edge flares appear at the start and end boundaries while the upper field remains comparatively dark.
- This pack fixes the runtime surface to real Audacity rather than inferred source semantics alone.
