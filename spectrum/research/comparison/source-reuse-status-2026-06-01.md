# Source Reuse Status

Date: 2026-06-01
Status: in progress
Purpose: record the real status of "reuse ready blocks instead of reimplementing everything" across FFTW, FFmpeg/AVTX, and Audacity.

## Executive Status

The reuse strategy is active, but not symmetric across all donor projects.

- FFTW is already reused as a real product backend.
- FFmpeg/AVTX is already reused as a real auxiliary transform layer.
- Audacity is currently vendored and analyzed, but not yet reused as a callable module.

So the current architecture is not "we selected one donor and copied the rest semantically." It is already a mixed model:

- FFTW provides the primary spectral/query core.
- AVTX provides auxiliary transform families not covered by the FFTW worker path.
- Audacity currently provides semantics/reference direction and a possible future extraction target, but not a proven headless integration surface.

## FFTW Status

Current state:
- integrated
- static-linked
- used by the live worker path

What is already reused:
- upstream FFTW transform implementation is used through the product-local Pascal binding in `SpectrumCore\lib\src\SpectrumCoreFftw3f.pas`
- the validated worker in `SpectrumCore\cli\SpectrumCoreFftwWorkerProbe.pas` uses that binding directly
- the product did not port FFTW algorithms into Pascal; it reuses the proven native implementation and builds product logic around it

What still remains product-owned:
- STFT frame store
- JSON worker contract
- tile projection
- point query and area query semantics
- higher-level analytics modes and future edit-oriented logic

Interpretation:
- FFTW reuse is already successful, but only at the transform layer
- the surrounding analysis/query system is still product code by design

## FFmpeg / AVTX Status

Current state:
- integrated
- static-linked
- validated as an auxiliary transform layer
- now tied to concrete worker-visible functionality, including a higher-level MDCT preview/resynthesis path

What is already reused:
- a pinned project-local tx-style subset from FFmpeg lives under `SpectrumCore\lib\vendor\avtx`
- the bridge and Pascal backend are live in:
  - `SpectrumCore\lib\src\SpectrumCoreAvtxBridge.pas`
  - `SpectrumCore\lib\src\SpectrumCoreAvtxBackend.pas`
  - `SpectrumCore\lib\src\SpectrumCoreAuxTransforms.pas`
  - `SpectrumCore\lib\src\SpectrumCoreAuxTransformRequests.pas`
- the transform kernel routes `MDCT/DCT/DST` family operations to AVTX
- library tests validate those routes and numeric execution

What this means in practice:
- AVTX is already more than a research note; it is real reusable code inside SpectrumCore
- it is no longer only a library capability: the worker now exposes both raw auxiliary transforms and a higher-level `mdct-edit-preview` capability on top of them
- that higher-level capability is now connected to the existing FFTW analysis-time mapping: the worker can source preview windows from an active analysis session by `analysisId` plus `timeSec` or `frameIndex`
- the open question is no longer "can we reuse AVTX at all?"; that is already answered yes
- the open question is no longer whether AVTX unlocks any product capability, but how far the new MDCT preview/resynthesis path should be taken in the actual editing workflow

Current gap:
- the new worker command `aux-transform` now depends on AVTX directly and exposes `MDCT/IMDCT/DCT/DST` on the same JSON boundary as the FFTW worker
- AVTX has therefore crossed from library-only reuse into live product-side worker functionality
- `mdct-edit-preview` now proves one higher-level user-visible capability on top of that auxiliary transform surface
- the first selection/edit-flow connection is now proven through analysis-window sourcing on `mdct-edit-preview`
- the remaining gap is narrower still: how that single-window preview/resynthesis path should grow into durable range-edit flows above the worker

## Audacity Status

Current state:
- vendored
- source-inspected
- not integrated
- no proven headless wrapper boundary yet

Important distinction:
- having the full Audacity source tree under `SpectrumCore\lib\vendor\audacity` is not yet the same as reusing Audacity in the product

Closest reusable surface found so far:
- `src\spectrogram\internal\au3\SpectrumCache.{h,cpp}`
- `src\spectrogram\internal\au3\au3spectrogramsettings.h`

Why this is not yet a clean reusable boundary:
- `SpectrumCache` depends on Audacity clip/channel reader abstractions and wave-track data structures
- it uses Audacity FFT helpers and settings objects rather than a narrow C-style ABI
- it pulls in Qt concurrency and AU3 track attachments/settings infrastructure
- it is not a small standalone library surface ready for FPC linkage

Why the other obvious surfaces are worse:
- `au3\src\FreqWindow.{h,cpp}` is a wxWidgets dialog/UI implementation, not a headless compute module
- `au3\src\SpectralDataManager.{h,cpp}` is tied to Audacity project history, WaveTrack editing, view/subview model, and spectral editing workflow

Current conclusion:
- Audacity has not yet yielded a reusable module comparable to FFTW or AVTX
- the likely feasible path is selective extraction or semantic porting of narrow algorithm/settings logic, not direct wholesale reuse of the existing UI/app-layer code
- until a narrow headless boundary is proven, Audacity remains a semantics/source candidate rather than a linked backend

Focused extraction audit:
- `c:\projects\KKMindWave\GnauralCore\spectrum\research\comparison\audacity-spectrumcache-extraction-audit-2026-06-01.md`
- current verdict: `SpecCache` is the right donor surface to study, but direct wrapping is still heavier than selective porting into the worker-owned SpectrumCore model
- a product-local headless prototype now exists for the portable cache-rule slice in `SpectrumCore\cli\core\SpectrumCoreViewportCache.pas` and `SpectrumCore\cli\SpectrumCoreViewportCacheProbe.pas`; this confirms that `Matches` / `findCorrection` / `fillWhere` are good port targets even though `WaveClipSpectrumCache` is not
- that prototype slice is now also wired into the FFTW worker `get-tile` path for overlapping requests, so the cache-rule port has crossed from proof code into a live product-side behavior

## Current Mixed-Backend Reality

As of this date, SpectrumCore is already combining strengths from multiple donor projects, but at different maturity levels:

- FFTW contributes the proven primary FFT engine.
- FFmpeg/AVTX contributes proven auxiliary transform families.
- Audacity contributes a candidate source of higher-level spectrogram semantics, but that track is still at the extraction-analysis stage.

That means the original idea is partially realized already, but only FFTW and AVTX have crossed from "vendor source present" into "actual reusable product block."

## Immediate Recommendation

Treat the next Audacity step as a narrow extraction audit, not as a parity exercise and not as a default assumption that the whole source tree can be linked the same way as FFTW or AVTX.

The concrete question should be:

- can `SpectrumCache` plus its nearest non-UI dependencies be isolated behind a small headless wrapper, or is selective porting the only realistic path?

Until that question is answered, the most accurate status statement is:

- FFTW reuse: proven
- AVTX reuse: proven at transform-layer level
- Audacity reuse: not yet proven; source tree present, extraction boundary still unclosed
