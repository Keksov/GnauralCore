# Audacity SpectrumCache Extraction Audit

Date: 2026-06-01
Status: completed
Scope: narrow feasibility audit of extracting or wrapping Audacity's `SpectrumCache` level for SpectrumCore

## Question

Can the Audacity spectrogram cache layer be reused in SpectrumCore as a small headless module, or is selective porting the realistic path?

## Audited Surface

Primary files:
- `c:\projects\KKMindWave\SpectrumCore\lib\vendor\audacity\src\spectrogram\internal\au3\SpectrumCache.h`
- `c:\projects\KKMindWave\SpectrumCore\lib\vendor\audacity\src\spectrogram\internal\au3\SpectrumCache.cpp`
- `c:\projects\KKMindWave\SpectrumCore\lib\vendor\audacity\src\spectrogram\internal\au3\au3spectrogramsettings.h`
- `c:\projects\KKMindWave\SpectrumCore\lib\vendor\audacity\src\spectrogram\internal\iclipchannelreader.h`
- `c:\projects\KKMindWave\SpectrumCore\lib\vendor\audacity\src\spectrogram\internal\au3\au3clipchannelreader.h`
- `c:\projects\KKMindWave\SpectrumCore\lib\vendor\audacity\src\spectrogram\internal\au3\au3concurrentclipchannelreader.h`
- `c:\projects\KKMindWave\SpectrumCore\lib\vendor\audacity\src\spectrogram\internal\au3\au3spectrogramutils.h`

## What Is Attractive About `SpectrumCache`

This is the nearest non-UI spectrogram compute surface inside vendored Audacity.

Useful capabilities already present there:
- raw spectrogram cache growth and reuse via `freq` and `where`
- cache-match / dirty-region logic
- log-power conversion and frequency-dependent gain shaping
- reassignment branch with `timeCorrection` and `freqCorrection`
- constant-Q diversion point via `PopulateConstantQ`
- partial-copy and refill behavior for viewport-driven redraws

This is exactly why `SpectrumCache` is the only realistic extraction candidate above the pure algorithm level.

## Dependency Closure

### Clean or Almost-Clean Parts

- `IClipChannelReader` is already a small abstract boundary with one method: `readSamples(...)`.
- The internal spectrogram math itself is not inherently tied to wxWidgets UI.
- The cache state (`freq`, `where`, `dirty`, `windowSize`, `zeroPaddingFactor`, `frequencyGain`) is structurally portable.

### Hard Couplings

`SpectrumCache` is not a drop-in headless library today because it still depends on these Audacity-specific surfaces:

- `WaveChannelInterval` / `WaveClipChannel`
- `WaveClipListener` lifecycle in `WaveClipSpectrumCache`
- `Au3SpectrogramSettings`, which inherits Audacity `TrackAttachment`
- Audacity FFT helper types and window infrastructure
- `AudioSegmentSampleView` through AU3 clip readers
- `QtConcurrent::blockingMap` as the current concurrency policy
- Audacity-specific `fillWhere` / `findCorrection` / trim / stretch behavior around clip display state

### Particularly Important Separation

There are two different layers here:

1. `SpecCache`
This is the closest thing to a reusable compute/cache unit.

2. `WaveClipSpectrumCache`
This is already attached to Audacity clip lifecycle and listener invalidation semantics.

That second layer is the one that makes direct extraction unattractive.

## Feasibility By Layer

### A. Reuse `WaveClipSpectrumCache` as-is

Verdict:
- not feasible for SpectrumCore

Reason:
- it is tied to Audacity clip ownership, invalidation callbacks, trim semantics, and channel attachment machinery
- SpectrumCore already has a different canonical ownership model: long-lived worker sessions with product-owned analysis stores

### B. Wrap `SpecCache` with replaced dependencies

Verdict:
- partially feasible in theory
- still expensive

What would need to be replaced:
- `WaveChannelInterval` with a plain SpectrumCore reader/input abstraction
- `Au3SpectrogramSettings` with a plain settings record or wrapper
- `QtConcurrent` with SpectrumCore's own execution strategy
- Audacity `where` fill/correction helpers with product-local equivalents
- Audacity FFT helper hooks with SpectrumCore/FFTW-backed equivalents where appropriate

Interpretation:
- this is not a thin wrapper job anymore
- it is closer to transplanting `SpecCache` logic into a new host shell

### C. Port selected `SpecCache` logic into SpectrumCore

Verdict:
- most realistic path

What is worth porting:
- frequency-dependent gain shaping
- reassignment math
- viewport-oriented `where` / `freq` cache rules where they fit the SpectrumCore tile model
- cache hit / partial refill ideas, if the worker grows a viewport cache above its canonical frame store

Reason:
- SpectrumCore already owns the analysis store and worker protocol
- direct porting lets the product preserve the right architecture boundary instead of importing Audacity clip lifecycle assumptions

## Prototype Evidence

A product-local headless prototype now exists for the most portable `SpecCache` rules:

- `c:\projects\KKMindWave\SpectrumCore\cli\core\SpectrumCoreViewportCache.pas`
- `c:\projects\KKMindWave\SpectrumCore\cli\SpectrumCoreViewportCacheProbe.pas`
- `c:\projects\KKMindWave\SpectrumCore\cli\build_viewport_cache_probe_x64.bat`

What it proves in code:
- tolerant `Matches(...)` behavior for cache signatures
- product-local `findCorrection` port for overlap alignment
- product-local `fillWhere` port for headless `where[]` sample mapping
- reuse-window computation without `WaveClipSpectrumCache`, `WaveClipListener`, or AU3 clip/channel readers

Validated probe result:
- build succeeded for the standalone probe
- the shifted viewport case returned `oldX0=2`, `copyBegin=0`, `copyEnd=6`
- `matchBase=true` and `matchShifted=true`, which is the expected outcome when only the viewport origin changes but the cache signature remains compatible

Interpretation:
- the cache-rule math is portable
- the Audacity ownership/lifecycle shell is still not worth importing
- this strengthens the verdict that selective porting is the right boundary

## Net Verdict

`SpectrumCache` is the correct place to study, but not the correct thing to import wholesale.

Most accurate conclusion:
- **full direct extraction**: no
- **narrow wrapper with heavy dependency replacement**: possible, but expensive and fragile
- **selective port of math + cache rules**: yes, and likely the best route

## Recommended Next Step

Do not attempt to link `WaveClipSpectrumCache` or the broader Audacity spectrogram stack into SpectrumCore.

Instead:

1. port `frequencyGain` semantics and related display behavior into the current SpectrumCore analysis/view layer;
2. port reassignment math next on top of the existing FFTW-owned frame pipeline;
3. only if needed later, copy the cache-rule ideas from `SpecCache` into a product-local viewport cache design.

## One-Sentence Summary

The audit says `SpectrumCache` is valuable as a donor of spectrogram math and cache behavior, but SpectrumCore should port those ideas into its own worker-owned model rather than trying to wrap the Audacity cache stack as a library.
