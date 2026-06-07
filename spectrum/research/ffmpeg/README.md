# FFmpeg Reference Pack Index

Date: 2026-06-03
Status: local-build reference packs captured for the current R5A fixture set

## Runtime

- Source tree: `c:\projects\KKMindWave\SpectrumCore\lib\vendor\FFmpeg`
- Build script: `c:\projects\KKMindWave\SpectrumCore\lib\build_ffmpeg.bat`
- Local runtime: `c:\projects\KKMindWave\SpectrumCore\lib\build\ffmpeg-win64\install\bin\ffmpeg.exe`
- Local probe runtime: `c:\projects\KKMindWave\SpectrumCore\lib\build\ffmpeg-win64\install\bin\ffprobe.exe`
- Output format note: this build does not include the PNG encoder, so the saved raster artifacts use BMP.
- Filter note: `showspectrumpic` still rejects `overlap` on the parity tuple, so each pack keeps `showspectrum:slide=fullframe` BMP captures plus failed `showspectrumpic` logs.

## Captured Packs

- `chirp_20_8000_3s`
- `impulse_train_2s`
- `melodic_contour_pitch_eac_4s`
- `multitone_440_880_1760_2s`
- `silence_1s`
- `sine440_1s_mono_44k`
- `transient_burst_reassignment_2s`

Each fixture directory contains:

- `README.md` with the exact local FFmpeg runtime path and the common filter prefix
- `ffmpeg-version.txt`
- `ffprobe-stream.txt`
- `input-sha256.txt`
- `showspectrum-fullframe-{magnitude,phase,uphase}.bmp`
- matching `showspectrum-fullframe-*.log` files
- `showspectrumpic-*.log` failure evidence for the same overlap-based tuple