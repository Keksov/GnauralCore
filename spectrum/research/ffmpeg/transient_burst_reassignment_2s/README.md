# FFmpeg transient_burst_reassignment_2s Reference Pack

Date: 2026-06-03
Status: captured from local vendored-source build
Fixture: `c:\projects\KKMindWave\SpectrumCore\cli\build\x64\transient_burst_reassignment_2s.wav`

## Runtime

- Executable: `c:\projects\KKMindWave\SpectrumCore\lib\build\ffmpeg-win64\install\bin\ffmpeg.exe`
- Probe executable: `c:\projects\KKMindWave\SpectrumCore\lib\build\ffmpeg-win64\install\bin\ffprobe.exe`
- Version string saved in `ffmpeg-version.txt`
- Input file hash saved in `input-sha256.txt`
- Input stream summary saved in `ffprobe-stream.txt`

## Live Reference Commands

The local FFmpeg build accepts the parity tuple on `showspectrum`, but this build does not include the PNG encoder, so the saved raster outputs use BMP instead of PNG.

Common filter prefix:

```text
showspectrum=s=640x512:slide=fullframe:mode=combined:fscale=log:win_func=hann:overlap=0.75:start=80:stop=4000:gain=1:drange=120:limit=0:legend=0:color=intensity
```

Saved captures:
- `showspectrum-fullframe-magnitude.bmp`
- `showspectrum-fullframe-phase.bmp`
- `showspectrum-fullframe-uphase.bmp`

Matching stderr/stdout logs:
- `showspectrum-fullframe-magnitude.log`
- `showspectrum-fullframe-phase.log`
- `showspectrum-fullframe-uphase.log`

## Runtime Surface Note

The local FFmpeg build still rejects `overlap` on `showspectrumpic`, so the parity tuple remains captured through `showspectrum:slide=fullframe` and the failed `showspectrumpic` logs are retained as evidence.

- showspectrumpic-magnitude.log captures the expected local-build failure for the overlap-based tuple.
- showspectrumpic-phase.log captures the expected local-build failure for the overlap-based tuple.
- showspectrumpic-uphase.log captures the expected local-build failure for the overlap-based tuple.

## Interpretation Limits

- These FFmpeg artifacts are raster references only.
- They are not a queryable-data baseline.
- They are suitable for visual parity checks against SpectrumCore tiles and manual Audacity captures.
