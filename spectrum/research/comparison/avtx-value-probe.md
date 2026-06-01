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

- no user-facing worker command or product feature depends on AVTX yet;
- the FFTW worker remains the only closed spectral/query path;
- therefore the AVTX value probe is still open even though the transform-layer reuse itself is proven.

Current verdict:

- **technical reuse**: proven
- **product-value case**: not yet proven
- **promotion beyond auxiliary status**: not justified yet