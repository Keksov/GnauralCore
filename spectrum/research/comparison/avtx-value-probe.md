# AVTX Value Probe

## Question

Does `FFmpeg/libavutil AVTX` materially improve `SpectrumCore` beyond what an `FFTW`-backed spectral worker already provides, **and** can it do so under the monolithic exe requirement?

This probe is intentionally narrow. It does **not** ask whether AVTX is a good transform library in general. It asks whether its broader transform-family surface changes the shipped product enough to justify a second backend path.

## What Counts As Value

AVTX passes this probe only if both conditions are met:

1. static/object linkage into the final exe is plausible for the required FFmpeg subset;
2. at least one of these product-value cases is demonstrated with a concrete product-level use case:

1. `MDCT` support enables a planned feature that cannot be closed cleanly with the FFTW-first spectral worker.
2. `DCT` or `DST` support materially simplifies a planned feature, not just a hypothetical one.
3. A mixed backend (`FFTW` for spectral core, `AVTX` for other transform families) remains compatible with the same worker/query contract and does not force a second canonical data model.

## What Does Not Count

These are not enough on their own:

1. AVTX supports more transform families on paper.
2. AVTX could theoretically be useful later.
3. AVTX avoids depending on FFTW in some future build profile.

## Minimum Evidence

1. One concrete planned feature mapped to `MDCT`, `DCT`, or `DST`.
2. One minimal integration sketch showing how that transform family fits into the same worker architecture.
3. One explicit statement of what extra product capability is unlocked.
4. One explicit statement that point/area query and editing feedback for the spectral path stay unchanged.
5. One static-link sketch identifying the minimal FFmpeg objects/libs needed for the monolithic exe.

## Pass / Fail Rule

- **PASS**: AVTX broadens the shipped feature set without weakening the queryable spectral worker model and without breaking the monolithic exe requirement.
- **FAIL**: AVTX is only broader in theory, or requires a linkage/deployment shape that violates the monolithic exe requirement.

## Current Bias

Until this probe passes, `FFTW` remains the preferred primary spectral core and `AVTX` remains auxiliary.

## Current Status Snapshot

As of `2026-06-01`, the engineering-side reuse question is already partly answered:

- a project-local FFmpeg `tx` subset is vendored under `SpectrumCore\lib\vendor\avtx`;
- the subset is wrapped by the stable bridge/Pascal layer in `SpectrumCore\lib\src`;
- native library tests already validate routing and numeric execution for `MDCT`, `IMDCT`, `DCT`, and `DST` through the SpectrumCore kernel.

That means the question is **no longer** whether AVTX can be reused technically inside SpectrumCore. It already can.

The still-open question is narrower:

- which concrete shipped feature becomes stronger because those auxiliary transforms exist?

Current answer:

- the worker now exposes a concrete AVTX-facing command, `aux-transform`, on the same JSON process boundary as the FFTW spectral path;
- the first selected feature hook is `MDCT/IMDCT`, with `DCT/DST` available on the same auxiliary request surface;
- the first higher-level product-side capability is now also proven: `mdct-edit-preview` takes PCM samples, performs MDCT forward, applies simple coefficient edits, and returns full IMDCT preview samples plus `peakAbs`/`rms` without changing the FFTW-owned spectral path;
- that same `mdct-edit-preview` path can now source its input window from an active FFTW analysis session by `analysisId` plus `timeSec` or `frameIndex`, which proves the first direct bridge from the canonical worker selection/time mapping into AVTX preview/resynthesis;
- current monolithic-link sketch is concrete in the probe binary: `SpectrumCoreFftwWorkerProbe.exe` links `libfftw3f.a`, `libavtx_bridge.a`, and `libucrt.a`, with AVTX isolated behind the project-local bridge archive built from the vendored tx subset;
- the FFTW worker still remains the only canonical spectral/query path;
- therefore the AVTX value probe is no longer blocked on either “no product hook exists” or “no higher-level capability exists”; the remaining open question is how far this analysis-coupled preview/resynthesis path should be integrated into a larger editing workflow.

Current verdict:

- **technical reuse**: proven
- **initial worker-visible feature hook**: proven
- **first higher-level product-value case**: proven
- **analysis-coupled preview path**: proven
- **broader product-value case**: partially open
- **promotion beyond transform-layer-only status**: justified