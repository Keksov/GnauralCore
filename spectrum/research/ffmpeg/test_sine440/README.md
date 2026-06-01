# FFmpeg Test Sine440 Reference Pack

Date: 2026-06-01
Status: captured
Fixture: `c:\projects\KKMindWave\SpectrumCore\cli\build\x64\test_sine440.wav`

## Runtime

- Executable: `c:\bin\ffmpeg-7.1-N-119861-g5fea5e3e11-20250610\bin\ffmpeg.exe`
- Version string saved in `ffmpeg-version.txt`
- Input file hash saved in `input-sha256.txt`

## Live Reference Commands

The installed FFmpeg build supports `overlap` and `data` on `showspectrum`, but not on `showspectrumpic`. Because the goal here is to keep the same analysis-affecting tuple as the worker probe, the live captures use `showspectrum` with `slide=fullframe`.

Common filter prefix:

```text
showspectrum=s=640x512:slide=fullframe:mode=combined:fscale=log:win_func=hann:overlap=0.75:start=80:stop=4000:gain=1:drange=120:limit=0:legend=0:color=intensity
```

Saved captures:
- `showspectrum-fullframe-magnitude.png`
- `showspectrum-fullframe-phase.png`
- `showspectrum-fullframe-uphase.png`

Matching stderr/stdout logs:
- `showspectrum-fullframe-magnitude.log`
- `showspectrum-fullframe-phase.log`
- `showspectrum-fullframe-uphase.log`

## Runtime Surface Mismatch

The donor source snapshot under `SpectrumCore\lib\vendor\FFmpeg\libavfilter\avf_showspectrum.c` advertises `data` and `overlap` on the shared implementation surface, but the installed `showspectrumpic` filter in this FFmpeg build rejects `overlap`.

Evidence retained:
- `showspectrumpic-magnitude.log`
- `showspectrumpic-phase.log`
- `showspectrumpic-uphase.log`

These failed logs are kept intentionally because they record a real version/surface mismatch between the donor code snapshot and the installed runtime tool.

## Interpretation Limits

- These FFmpeg artifacts are raster references only.
- They are not yet a queryable-data baseline.
- They are suitable for visual parity checks against SpectrumCore tiles and later manual Audacity captures.
