# Version Manifest — Spectrogram Research

Generated: 2026-06-01
Status: worker-oriented decision path selected; `SpectrumCore` is now treated as a standalone GPL CLI utility. FFTW native-static worker proof is now saved; reproducibility closure still pending immutable source identity for all trees, AVTX value proof, and final parity evidence.

## FPC Toolchain
- FPC: `c:\projects\KKMindWave\VendorsCore\fpc\fpc-main`
- Source tree revision: `main @ fa235b07a324817568d1473711c761d96ad32d90`
- Bin: `fpc-main\bin\x86_64-win64\fpc.exe`
- Units: `fpc-main\units\x86_64-win64\`
- FFTW package (precompiled): `fpc-main\units\x86_64-win64\fftw\fftw_s.ppu`
  - Binding: single precision, wraps `libfftw3f` (name `libfftw3f.dll` on Windows)

## Candidate B — uos TFFT
- Source: `c:\projects\KKMindWave\GnauralCore\cli\vendor\uos\src\uos_dsp_noiseremoval.pas`
- GnauralCore source tree revision: `main @ 12c891546d3ba81724b596082c2bdeadd395e179`
- Companion: `uos_dsp_utils.pas` (same directory; contains IPAIODataIOInterface — not needed for TFFT alone)
- Algorithm: split-radix real FFT (from Audacity hfft.cpp, converted to Pascal)
- Source hash (`uos_dsp_noiseremoval.pas`, SHA256): `1FDB2F65DC76731ABDF2A54C43E4048349900AAA062757A863E839B887DE3C32`
- Provenance hash (`contributors.txt`, SHA256): `1D7CF5A8854F34DD301AEDBF6F8B59946A6274EB0AB065C8B3C6809BC2B34E26`
- License: header says `modified LGPL`, but provenance is unresolved because the same header says the code was converted from Audacity GPLv2
- DLL required: none

## Candidate A — FFTW
- Upstream source tree: `c:\projects\fftw3-master`
- Legacy binding source: `c:\projects\KKMindWave\VendorsCore\fpc\sources\main\packages\fftw\src\fftw_s.pas`
- Shipping/probe binding source: `c:\projects\KKMindWave\SpectrumCore\lib\src\SpectrumCoreFftw3f.pas`
- Static link include: `c:\projects\KKMindWave\SpectrumCore\lib\src\SpectrumCoreFftw3fStatic.inc`
- FPC packages tree revision: `main @ fa235b07a324817568d1473711c761d96ad32d90`
- Precompiled: `fpc-main\units\x86_64-win64\fftw\{fftw_s.ppu, libimpfftw_s.a}`
- Static archive: `c:\projects\KKMindWave\SpectrumCore\lib\build\fftw-static-win64\install\lib\libfftw3f.a`
- Additional import lib for native static link on Windows: `c:\bin\msys64\mingw64\lib\libucrt.a`
- License: GPL 2.0+ (FFTW library itself)
- DLL required for the validated worker probe: NO
- Current research role: preferred primary spectral core for the standalone worker architecture
- Integration note: best treated as linked transform backend, not as a source to port into Pascal
- Probe note: `SpectrumCoreFftwWorkerProbe.exe` now validates as a long-lived JSON worker through the product-local native static binding, with saved evidence in `c:\projects\KKMindWave\GnauralCore\spectrum\research\fftw\worker-probe-validation-2026-06-01.md`
- Shipping-gate note: the Windows native static/object-link path is now proven for the worker probe; production closure still requires broader parity evidence and immutable provenance capture for the reference trees
- Binding note: the old FPC unit `fftw_s.pas` remains DLL/import-oriented on Windows and should be treated as legacy for this product path; the validated path is the product-local static-oriented binding in `SpectrumCore\lib\src`

## Candidate C — FFmpeg
- Source: `c:\projects\FFmpeg-master`
- Git metadata: unavailable in current workspace local tree (`NO_GIT`)
- Key files: `libavutil\tx.h` (AVTXContext), `libavfilter\avf_showspectrum.c`
- Probe file hash (`libavfilter\avf_showspectrum.c`, SHA256): `5A377E8696B0F485B902981AE29C921A0BFCD943E42AD22A16636A7D0D640093`
- Live runtime on PATH during parity capture: `c:\bin\ffmpeg-7.1-N-119861-g5fea5e3e11-20250610\bin\ffmpeg.exe`
- `magnitudes[]` and `phases[]` are private fields inside ShowSpectrumContext — not part of public API
- Direct-link: requires linking libavutil, libavfilter, libavcodec, libavformat — multi-DLL, complex
- CLI shell-out: `ffmpeg -lavfi showspectrumpic` → PNG reference only, not queryable data
- License: LGPL 2.1 (with GPL components for some codecs)
- Reproducibility note: local tree identity is not yet immutable; capture archive/source provenance before final closure
- Current research role: preferred auxiliary transform-family path (`AVTX`) and FFmpeg raster reference path
- Shipping-gate note: no static `libavutil`/AVTX link artifacts are currently present in the workspace; monolithic object-link feasibility remains unproven
- Runtime filter note: the installed FFmpeg build exposes `overlap` and `data` on `showspectrum`, but `showspectrumpic` rejects `overlap`; the initial parity capture for `test_sine440` therefore uses `showspectrum:slide=fullframe` and retains failed `showspectrumpic` logs as evidence of the surface mismatch

## Candidate D — Audacity
- Source: `c:\projects\audacity-master`
- Git metadata: unavailable in current workspace local tree (`NO_GIT`)
- Key files: `src\spectrogram\internal\au3\SpectrumCache.{h,cpp}`, `au3\src\FreqWindow.{h,cpp}`
- Probe file hash (`src\spectrogram\internal\au3\SpectrumCache.h`, SHA256): `D13E2F6188ACCB14C72EDAB69F4EAC346AB641B879963D9C788DF359EFCD4463`
- `SpectrumCache::Populate()` depends on `WaveClip`, `WaveClipChannel`, `WaveClipListener` (au3 data model)
- `FrequencyPlotDialog` depends on wxWidgets (`wxDialogWrapper`, `wxWindow`, etc.) — NOT headless
- No clean C-callable boundary; the au3 layer is tightly coupled to Qt/wx UI stack
- External process invocation: FORBIDDEN (per plan)
- Reproducibility note: local tree identity is not yet immutable; capture archive/source provenance before final closure

## Current Gaps
- `FFTW` now has a proved Windows static/object-link worker path; remaining work is parity/reference closure and deciding whether additional queryable data modes such as phase should extend the same canonical analysis model.
- `AVTX` still needs both a narrow value proof and a static/object-link feasibility proof for a monolithic exe.
- FFmpeg and Audacity local trees need immutable provenance beyond filesystem path naming.
- Parity evidence is started for `test_sine440`: FFTW worker baseline and FFmpeg live raster captures exist, while Audacity capture is still pending because no executable was available in the current environment.
- Final parity closure still requires saved reference outputs/observations from real Audacity on the agreed fixture set.
- `uos` remains probe-only unless its provenance issue is explicitly resolved and the decision path is reopened.
