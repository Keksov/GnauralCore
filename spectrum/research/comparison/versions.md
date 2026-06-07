# Version Manifest — Spectrogram Research

Generated: 2026-06-03
Status: worker-oriented decision path selected; `SpectrumCore` is now treated as a standalone GPL CLI utility. FFTW native-static worker proof, the first analysis-coupled AVTX preview flow, the first analysis-range AVTX preview flow, the reusable-session Audacity capture path, strict SpectrumCore comparison manifests with `magnitude`, `phase`, and `uphase` coverage for the full current R5A fixture set, a saved local-source provenance record for the vendored FFmpeg/Audacity trees, and an archived strict R5A parity baseline are now saved in-workspace. The canonical normalized sine comparison pack now lives under `research\comparison\sine440_1s_mono_44k`, while `research\comparison\test_sine440` is retained as historical provenance only. Full reproducibility closure is still partial only in the narrower sense that historical external FFmpeg/Audacity trees remain unavailable.

## FPC Toolchain
- FPC: `c:\projects\KKMindWave\VendorsCore\fpc\fpc-main`
- Source tree revision: `main @ fa235b07a324817568d1473711c761d96ad32d90`
- Bin: `fpc-main\bin\x86_64-win64\fpc.exe`
- Units: `fpc-main\units\x86_64-win64\`
- FFTW package (precompiled): `fpc-main\units\x86_64-win64\fftw\fftw_s.ppu`
  - Binding: single precision, wraps `libfftw3f` (name `libfftw3f.dll` on Windows)
- Legacy FFTW binding hash (`packages\fftw\src\fftw_s.pas`, SHA256): `058086A4E9438519A0F5DC555A1834EB01AD31E2F9860B5CCAF1D999C1C48478`

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
- Historical upstream source tree: `c:\projects\fftw3-master` (not available in the current environment on `2026-06-02`)
- Legacy binding source: `c:\projects\KKMindWave\VendorsCore\fpc\sources\main\packages\fftw\src\fftw_s.pas`
- Shipping/probe binding source: `c:\projects\KKMindWave\SpectrumCore\lib\src\SpectrumCoreFftw3f.pas`
- Static link include: `c:\projects\KKMindWave\SpectrumCore\lib\src\SpectrumCoreFftw3fStatic.inc`
- FPC packages tree revision: `main @ fa235b07a324817568d1473711c761d96ad32d90`
- SpectrumCore tree revision: `main @ b5433b52041a171eaec86973c96ed675e4a76106`
- Precompiled: `fpc-main\units\x86_64-win64\fftw\{fftw_s.ppu, libimpfftw_s.a}`
- Static archive: `c:\projects\KKMindWave\SpectrumCore\lib\build\fftw-static-win64\install\lib\libfftw3f.a`
- Additional import lib for native static link on Windows: `c:\bin\msys64\mingw64\lib\libucrt.a`
- Shipping binding hash (`SpectrumCoreFftw3f.pas`, SHA256): `341B4FFD7DAEFCFFED7431BA3F4890DE99F69D4914CF3ACEAE373203F1DC4268`
- Static include hash (`SpectrumCoreFftw3fStatic.inc`, SHA256): `AABDC676C321C91B1E6AE20BF9C2E3A662584CCE3DC642AB0E49DDF00B5AB82C`
- Static archive hash (`libfftw3f.a`, SHA256): `0CBDABB14A0562B5DF16159360849EF7F914B717B1660D8C656F0D674456CCC7`
- License: GPL 2.0+ (FFTW library itself)
- DLL required for the validated worker probe: NO
- Current research role: preferred primary spectral core for the standalone worker architecture
- Integration note: best treated as linked transform backend, not as a source to port into Pascal
- Probe note: `SpectrumCoreFftwWorkerProbe.exe` now validates as a long-lived JSON worker through the product-local native static binding, with saved evidence in `c:\projects\KKMindWave\GnauralCore\spectrum\research\fftw\worker-probe-validation-2026-06-01.md`
- Shipping-gate note: the Windows native static/object-link path is now proven for the worker probe; production closure still requires broader parity evidence and immutable provenance capture for the missing historical reference trees
- Binding note: the old FPC unit `fftw_s.pas` remains DLL/import-oriented on Windows and should be treated as legacy for this product path; the validated path is the product-local static-oriented binding in `SpectrumCore\lib\src`

## Candidate C — FFmpeg / AVTX
- Historical external full-source tree: `c:\projects\FFmpeg-master` (not available in the current environment on `2026-06-02`)
- Current vendored full-source tree: `c:\projects\KKMindWave\SpectrumCore\lib\vendor\FFmpeg`
- Current vendored AVTX subtree: `c:\projects\KKMindWave\SpectrumCore\lib\vendor\avtx`
- SpectrumCore tree revision: `main @ b5433b52041a171eaec86973c96ed675e4a76106`
- Local build script: `c:\projects\KKMindWave\SpectrumCore\lib\build_ffmpeg.bat`
- Local build script hash (`build_ffmpeg.bat`, SHA256): `1D4A99622A4327BEAA5AF5BE6190FF5D4E79E267FD7D0661C620F6229D85D89D`
- Current vendored full-tree revision: `bf608f16fd6772b1977a2637e8ab49644f6b5eb5` from `https://github.com/FFmpeg/FFmpeg.git`, working tree `clean`
- Vendored subset note: the current reproducible pin is the in-repo `tx` subset plus bridge code, not the missing external full FFmpeg tree
- Vendored full-tree key hash (`README.md`, SHA256): `7E30F809D40454EBC467CF473A063D7306F5EB836DCA6B80668C4427D8845914`
- Vendored full-tree key hash (`LICENSE.md`, SHA256): `2E1D16C72FD74E12063776371DA757322F8B77589386532F4FD8634BDE7DE1AF`
- Vendored full-tree key hash (`RELEASE`, SHA256): `EC416D91D2C97CDD5792600AB6A97D60B754ED2FF77CA816D4C18B8500A3A8D8`
- Vendored subset hash (`README.md`, SHA256): `CA6B6770AC2AB9B7F7DF55BB50EBD367278D15E9F1A01BCAF51E7864A547F680`
- Upstream note hash (`tx\UPSTREAM.md`, SHA256): `013B2ED5E3DF8EDD93A6CEFB7548A550B5FD239D3B7D2CE4E4451912C2BCC224`
- Vendored header hash (`tx\include\avtx_tx.h`, SHA256): `8EE2F2ADA0519BB57B9236382D3E00E3C8CA57687B6BF39AE73BA013A9A9A5BD`
- Vendored core hash (`tx\src\avtx_tx_core.c`, SHA256): `6F01C0DFC23C8FA9B772E28B9DC528801349680C1FEDF259CA58FB978A459CA1`
- Vendored DCT hash (`tx\src\avtx_tx_dct.c`, SHA256): `3995D82ABFC1C374011927CFB79FD975898022BF40038ECAE08C36BA7FDF6A7F`
- Vendored MDCT hash (`tx\src\avtx_tx_mdct.c`, SHA256): `50F827E0BC2A65A9424B69C6FE125652CFB2DAB3112765195AFA304628821742`
- Bridge header hash (`bridge\include\avtx_bridge.h`, SHA256): `33153AF6531092F053C4C76719D9212A8985A89990ED884C355BEFE7D3436AFD`
- Bridge source hash (`bridge\src\avtx_bridge.c`, SHA256): `B2F5D0BD70F22C5A05CECF44700BA12704DAE3F2AFE73BB3B94D673CC4EB2815`
- Bridge archive hash (`build\avtx-bridge-win64\libavtx_bridge.a`, SHA256): `8D9D0AD6D596F1C29D651AC8403C5051F8BC24CAA18B461C4688D86E77013280`
- Historical PATH runtime used for the initial `test_sine440` parity capture: `c:\bin\ffmpeg-7.1-N-119861-g5fea5e3e11-20250610\bin\ffmpeg.exe`
- Current local built runtime: `c:\projects\KKMindWave\SpectrumCore\lib\build\ffmpeg-win64\install\bin\ffmpeg.exe`
- Current local built probe runtime: `c:\projects\KKMindWave\SpectrumCore\lib\build\ffmpeg-win64\install\bin\ffprobe.exe`
- Current local built runtime version: `8.0.git`
- Local built runtime hash (`ffmpeg.exe`, SHA256): `8D79A3B81DE3F741BBED1D4676EB8096B01D0529BABE576B61F05D066E28F29B`
- Local built probe hash (`ffprobe.exe`, SHA256): `197EE91C680CD2797AE07F15444244AFA22F275611D6EC3F1ACB1026A001357B`
- Local build note: this FFmpeg build does not include the PNG encoder, so the current saved raster packs use BMP instead of PNG.
- `magnitudes[]` and `phases[]` are private fields inside ShowSpectrumContext — not part of public API
- Direct-link: requires linking libavutil, libavfilter, libavcodec, libavformat — multi-DLL, complex
- CLI shell-out: local `ffmpeg -lavfi showspectrum` → BMP reference only, not queryable data
- License: LGPL 2.1 (with GPL components for some codecs)
- Reproducibility note: the vendored full FFmpeg source tree, local build script, local built `ffmpeg`/`ffprobe` binaries, vendored AVTX slice, and saved R5A pack READMEs now pin the current FFmpeg reference path inside the workspace.
- Current research role: preferred auxiliary transform-family path (`AVTX`) and FFmpeg raster reference path
- Shipping-gate note: the monolithic link path is proven for the vendored AVTX subset through `libavtx_bridge.a`; what remains unproven is full external FFmpeg tree provenance and broader parity/reference closure
- Runtime filter note: the current local build accepts the parity tuple on `showspectrum`, but `showspectrumpic` still rejects `overlap`; the current R5A packs therefore use `showspectrum:slide=fullframe` with BMP captures and retain failed `showspectrumpic` logs as evidence.

## Candidate D — Audacity
- Historical full-source tree: `c:\projects\audacity-master` (not available in the current environment on `2026-06-02`)
- Current vendored donor tree: `c:\projects\KKMindWave\SpectrumCore\lib\vendor\audacity`
- Current vendored donor-tree revision: `716c5ff1235989cdb47e754f2ce1583fb8944572` from `https://github.com/audacity/audacity.git`, working tree `clean`
- Vendored donor-tree version marker: `version.cmake` reports `4.0.0` with prerelease flags enabled
- Vendored donor-tree submodule pin: `muse @ 3e3d513e2161b4fa62bdc52800b7c49f21b33b93` from `https://github.com/musescore/muse_framework.git`
- SpectrumCore tree revision: `main @ b5433b52041a171eaec86973c96ed675e4a76106`
- Runtime path (workspace-relative): `SpectrumCore/lib/build/audacity-win64/install/bin/Audacity4.exe`
- Runtime version from local config: `4.0.0`
- Runtime file version: `4.0.0`
- Runtime hash (`Audacity4.exe`, SHA256): `90C708BE394A76E04B74425FF393B27728F14011634552B58CB59BFBA2640E4B`
- Runtime scripting module: `not pinned in install tree (mod-script-pipe.dll not found during this update)`
- Runtime scripting module hash (`mod-script-pipe.dll`, SHA256): `n/a`
- Vendored donor-tree key hash (`README.md`, SHA256): `39F91A3415F83AD499014B1D83E45965990CE4D67342AACE9D72E4471E3B4E05`
- Vendored donor-tree key hash (`LICENSE.txt`, SHA256): `1580FFB4A0C6BBB716324C645682964120EAE418B9A1C51842CDA140343CB139`
- Vendored donor-tree key hash (`version.cmake`, SHA256): `E14E2FF602389812B00642FDEF71E0FA8CC1DCDD827561EDD74FDE0C94BE264F`
- Probe file hash (`SpectrumCache.h`, SHA256): `D13E2F6188ACCB14C72EDAB69F4EAC346AB641B879963D9C788DF359EFCD4463`
- Probe file hash (`SpectrumCache.cpp`, SHA256): `8EBEC097B6AD9867A4CFF099263E4E2ECE7888AF1492F563B546F87819CB896F`
- Probe file hash (`FreqWindow.cpp`, SHA256): `3F811593C499A48F430B1C96AADB0A713CD13D445F8F6C53700C18692D264DA7`
- `SpectrumCache::Populate()` depends on `WaveClip`, `WaveClipChannel`, `WaveClipListener` (au3 data model)
- `FrequencyPlotDialog` depends on wxWidgets (`wxDialogWrapper`, `wxWindow`, etc.) — NOT headless
- No clean C-callable boundary; the au3 layer is tightly coupled to Qt/wx UI stack
- External process invocation: FORBIDDEN (per plan)
- Live scripting note: `mod-script-pipe` is now enabled, the named pipes exist after launch, and vendored `pipeclient.py` works with `python -X utf8`.
- Runtime behavior note: `SetPreference` on legacy `/Spectrum/*` keys persists `MinFreq`, `MaxFreq`, `Gain`, `Range`, `ScaleType`, `FFTSize`, `WindowType`, `Algorithm`, and `FrequencyGain`; `Reload=1` resets the live spectrogram values to defaults, but a full process restart picks up the staged tuple.
- Live capture note: after restart, `Import2` plus `SetTrack: Display=Spectrogram SpecPrefs=1 Height=300` succeeds on `test_sine440.wav`, and a `PrintWindow` capture is saved at `c:\projects\KKMindWave\GnauralCore\spectrum\research\audacity\test_sine440\audacity-window-2026-06-03-printwindow.png` with SHA256 `48A38B9A11D697F19B632F077B45A43FAD50B0CC9FF51DC85912A9DF88316CA9`.
- Scripting surface note: `GetInfo:` and `Import2:` are available, but `Help: Command=Screenshot Format=JSON` returns `Command not found` in the installed build.
- Source mapping note: modern `colorGainDb` maps directly to AU3 / legacy `Gain`, modern `colorRangeDb` maps directly to `Range`, and the AU3 painter uses `(db + range + gain) / range`, so the displayed upper color limit is `-Gain dB`.
- Live comparison note: a second restart-based `PrintWindow` capture with `/Spectrum/Gain=1` is saved at `c:\projects\KKMindWave\GnauralCore\spectrum\research\audacity\test_sine440\audacity-window-2026-06-03-gain1-printwindow.png` with SHA256 `8E383D484E7C8D4876D0AC3BCB89BC58DB3D0CC71CCFDF80B8F7773BC321BCA8`; its broader spectrogram ROI is slightly brighter than the `Gain=0` capture, which is consistent with the source-defined mapping.
- R5A capture note: the same restarted parity session can be reused via `New + Import2 + SetTrack`, and live `PrintWindow` packs now exist for `sine440_1s_mono_44k`, `multitone_440_880_1760_2s`, `chirp_20_8000_3s`, `impulse_train_2s`, `silence_1s`, `melodic_contour_pitch_eac_4s`, and `transient_burst_reassignment_2s` under `c:\projects\KKMindWave\GnauralCore\spectrum\research\audacity`.
- Reproducibility note: the vendored donor surface is now pinned by repo revision plus key-file hashes, the gain semantics are source-backed, and the current reproducible Audacity floor includes the historical `test_sine440` pack plus the saved R5A reusable-session capture packs.

## Current Gaps
- `FFTW` now has a proved Windows static/object-link worker path, and the saved strict R5A comparison manifests already cover `magnitude`, `phase`, and `uphase` on the same canonical analysis model.
- `AVTX` now has both a narrow value proof and a static/object-link proof for the current vendored subset; remaining work is deciding how far the new analysis-coupled preview path should be lifted into a larger editing workflow.
- `AVTX` now also has an analysis-range worker proof through `mdct-edit-preview-range`; the remaining question is product scope, not whether the auxiliary backend can ride the FFTW-owned frame/time mapping.
- The historical external Audacity tree referenced by earlier notes is still not available in the current environment; for FFmpeg, the current reproducible floor now includes the vendored full source tree, local build script, built local binaries, and saved R5A raster packs.
- Parity evidence now includes the `test_sine440` FFTW worker baseline, the historical `test_sine440` FFmpeg and Audacity packs, local-build FFmpeg raster packs for the full current R5A set, reusable-session Audacity packs for that same set, strict SpectrumCore comparison manifests under `c:\projects\KKMindWave\GnauralCore\spectrum\research\comparison\<fixture>` for all seven canonical R5A fixtures, and the archived baseline record `c:\projects\KKMindWave\GnauralCore\spectrum\research\comparison\r5a-final-parity-baseline-2026-06-04.md`.
- The current strict SpectrumCore summary label is `match` for all seven canonical R5A fixtures, and each saved manifest now includes fixture-specific magnitude checks plus full `phase` / `uphase` mode-consistency checks.
- Current local reference-tree provenance is now pinned in `c:\projects\KKMindWave\GnauralCore\spectrum\research\comparison\reference-source-provenance-2026-06-04.md`; the remaining reproducibility nuance is historical external-tree availability, not the current workspace Audacity runtime path.
- `uos` remains probe-only unless its provenance issue is explicitly resolved and the decision path is reopened.
