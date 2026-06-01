# Audacity Reuse Triage

Date: 2026-06-01
Status: working triage
Purpose: classify useful Audacity spectrogram-related functionality into three buckets for SpectrumCore:

- port first
- attempt wrapper/extraction
- keep as semantic reference only

## Decision Rule

Use these buckets pragmatically:

- `Port first`: the feature is useful, algorithmically self-contained enough, and likely cheaper to reimplement in Pascal than to drag in Audacity UI/project dependencies.
- `Attempt wrapper/extraction`: the feature appears materially valuable and may benefit from preserving donor code shape, but only if a small headless boundary can be isolated.
- `Semantic reference only`: the feature is useful mainly as behavior/settings guidance, while the existing code is too entangled with UI, project state, or app-level data structures to justify direct reuse.

## Port First

### 1. Reassignment spectrogram math

Why:
- This is one of the strongest functional differentiators relative to raw FFTW/AVTX primitives.
- The useful part is the analysis math, not the surrounding Audacity app model.
- SpectrumCore already owns the canonical worker-side frame store, so porting the reassignment math into that model is cleaner than trying to import Audacity cache/application code wholesale.

Evidence anchors:
- `SpectrumCore\\lib\\vendor\\audacity\\src\\spectrogram\\internal\\au3\\SpectrumCache.cpp`
- reassignment branch using extra windows and `freqCorrection` / `timeCorrection`

Why not wrapper-first:
- Current donor code is entangled with clip readers, cache state, and Qt concurrency.
- The core math is easier to transplant than the whole surrounding call graph.

### 2. Spectrogram settings semantics

Examples:
- `minFreq` / `maxFreq`
- `range` / `gain`
- `frequencyGain`
- algorithm and scale choice semantics
- zero-padding and window sizing behavior

Why:
- These semantics already define user-visible behavior.
- SpectrumCore already has its own `TSpectrumAnalysisConfig`, so this is a natural port-and-align task.
- This gives direct value without forcing Audacity runtime coupling.

Evidence anchor:
- `SpectrumCore\\lib\\vendor\\audacity\\src\\spectrogram\\internal\\au3\\au3spectrogramsettings.h`

### 3. Frequency-dependent gain shaping

Why:
- This is a compact, reusable behavior layer rather than a large subsystem.
- It is clearly separable from UI and project state.
- It can be folded into SpectrumCore display/view transforms with low risk.

Evidence anchor:
- `SpectrumCore\\lib\\vendor\\audacity\\src\\spectrogram\\internal\\au3\\SpectrumCache.cpp`
- `ComputeSpectrogramGainFactors`

### 4. Peak analysis semantics for point inspection

Why:
- The useful value is the logic for reporting dominant peaks, not the wxWidgets dialog itself.
- SpectrumCore already has point-query and area-query; this is a natural place to import better semantics rather than donor UI code.

Evidence anchor:
- `SpectrumCore\\lib\\vendor\\audacity\\au3\\src\\FreqWindow.cpp`
- peak reporting / nearest-peak logic

## Attempt Wrapper / Extraction

### 1. `SpectrumCache` as a headless spectrogram cache core

Why it is the best extraction candidate:
- It is the closest thing in Audacity to a non-UI spectrogram engine.
- It already knows about cache validity, dirty regions, `where` mapping, and display-oriented spectrogram generation.
- If any Audacity spectrogram subsystem can be isolated, this is the most plausible starting point.

Evidence anchors:
- `SpectrumCore\\lib\\vendor\\audacity\\src\\spectrogram\\internal\\au3\\SpectrumCache.h`
- `SpectrumCore\\lib\\vendor\\audacity\\src\\spectrogram\\internal\\au3\\SpectrumCache.cpp`

What would have to be isolated:
- clip/channel reader abstraction
- settings object
- FFT helper dependency
- concurrency policy
- cache ownership without WaveClip listener attachment machinery

Current verdict:
- worth auditing
- not yet proven feasible

### 2. Minimal settings/cache bundle around `Au3SpectrogramSettings`

Why:
- `Au3SpectrogramSettings` plus cache-related helpers might provide a donor-shaped configuration model for future Audacity-like behavior.
- If reduced to plain structs plus cached windows, it might become a reusable donor-aligned module.

Current risk:
- it currently inherits from Audacity track attachment infrastructure and is not yet an isolated settings library.

Current verdict:
- possible extraction target only if stripped down aggressively

## Semantic Reference Only

### 1. `FreqWindow` frequency analysis dialog

Why semantic-only:
- It is fundamentally wxWidgets UI code.
- Its useful content is the exposed analysis modes and reporting behavior, not the dialog implementation.
- Reusing the code directly would import the wrong boundary.

Useful ideas to borrow semantically:
- analysis mode menu shape
- log-axis vs linear-axis behavior
- peak presentation conventions
- spectrum vs autocorrelation vs cepstrum user-facing distinctions

Evidence anchor:
- `SpectrumCore\\lib\\vendor\\audacity\\au3\\src\\FreqWindow.cpp`

### 2. `SpectralDataManager`

Why semantic-only:
- It is deeply tied to Audacity project history, track views, spectral subviews, and edit application workflow.
- The high-value ideas are its editing-oriented operations, not its concrete class boundary.

Useful ideas to borrow semantically:
- frequency snapping
- overtone search
- edit-range recompute workflow
- mapping spectral selections back to track mutations

Evidence anchor:
- `SpectrumCore\\lib\\vendor\\audacity\\au3\\src\\SpectralDataManager.cpp`

### 3. Full Audacity spectrogram UI/cache/application stack

Why semantic-only:
- The full stack crosses UI, project model, track model, history system, attachments, and threading.
- That is not the right integration shape for SpectrumCore, which is now a standalone worker with its own canonical data model.

Current conclusion:
- do not try to vendor-link the whole stack as if it were another library like FFTW
- use it as a source of behavior, settings semantics, and algorithm ideas

## Recommended Order

1. Port `frequencyGain` and related display semantics into SpectrumCore analysis/view transforms.
2. Prototype reassignment directly in SpectrumCore on top of the current FFTW-owned frame pipeline.
3. Run a narrow extraction audit on `SpectrumCache` only.
4. Treat `FreqWindow` and `SpectralDataManager` as semantic donors, not code-reuse targets.

## One-Line Summary

If the goal is to combine donor strengths without importing the wrong boundaries, then:

- take FFTW as the transform engine,
- keep AVTX as the auxiliary transform family layer,
- port Audacity's spectrogram semantics and selected algorithms,
- and only attempt direct code extraction from Audacity at the `SpectrumCache` level, not above it.
