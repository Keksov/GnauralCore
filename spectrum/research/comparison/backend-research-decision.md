# Backend Research Decision

**Date**: 2026-06-01  
**Status**: PROVISIONAL — standalone GPL worker architecture accepted; FFTW (Candidate A) now has a validated native-static worker proof in a monolithic exe. Final production approval still depends on parity evidence and immutable source pinning for the reference trees.

---

## Decision

**Current direction for the next implementation stage**

- Product boundary: `SpectrumCore` ships as a standalone GPL CLI utility.
- Integration boundary: long-lived worker process with documented JSON over `stdin/stdout`; closed hosts may integrate only across this executable/process boundary.
- Preferred primary spectral backend: **FFTW (Candidate A)**, but only through static/object linkage into the final exe.
- Preferred auxiliary transform path: **FFmpeg/libavutil AVTX (Candidate C)**.
- `uos` TFFT (Candidate B): **probe-only**, excluded from the current primary decision path.
- Audacity direct reuse (Candidate D): **reference semantics only**, not a shipping backend candidate unless a narrow headless boundary is later proven.

This is a **directional decision for the current architecture**, not final closure of the backend research task.

---

## Why The Decision Changed

The earlier decision treated GPL as a primary blocker and therefore favored a monolithic pure-Pascal path. That premise is no longer controlling: `SpectrumCore` itself is now allowed to ship as a standalone GPL CLI tool.

Because of that, the main question is no longer "which candidate avoids GPL?" but rather:

**Which backend best closes the spectral query/edit contract inside the standalone worker architecture?**

Under that question, `FFTW` is stronger than `AVTX` for the primary spectral-analysis path, while `AVTX` remains valuable as a broader transform-family backend. However, both candidates now pass the shipping gate only if they are linked into a **single monolithic executable without external DLL dependencies**.

---

## Primary Matrix: FFTW vs FFmpeg/libavutil AVTX

| Criterion | FFTW (A) | FFmpeg/libavutil AVTX (C) | Preferred |
|---|---|---|---|
| **Primary role fit** | Strong fit for a dedicated spectral-analysis core | Better fit for a general transform toolbox | FFTW |
| **Queryable spectral ownership** | Full ownership of buffers, STFT store, frame/bin mapping, magnitude/phase derivation | Only gives transforms; the same STFT/query store must still be built above it | FFTW |
| **Point/area query path** | Natural fit: worker can keep canonical spectral frames and answer queries directly | Possible, but only after building the same worker-side analysis store above AVTX | FFTW |
| **Editing feedback readiness** | Better fit because the product owns frame/bin/sample mapping end-to-end | Transform breadth does not by itself help selection-to-source mapping | FFTW |
| **Transform family breadth** | Strong for FFT/RDFT and related spectral work | Stronger overall: FFT/RDFT/MDCT/DCT/DST under one API | AVTX |
| **Worker simplicity** | Narrower backend surface, easier to wrap behind a stable worker protocol | Broader API and per-transform semantics increase adapter complexity | FFTW |
| **Spectrogram parity path** | Requires pure product-side implementation of STFT/windows/scales/query logic | Also requires pure product-side implementation for queryable spectrogram behavior | Tie |
| **Static/object-link feasibility** | Plausible from full FFTW source tree, but current FPC binding path is DLL/import-style and does **not** yet satisfy the monolithic gate | Plausible only through a custom static lib/object integration of a narrow FFmpeg subset; currently unproven and likely heavier | FFTW |
| **Packaging/integration friction** | Existing FPC binding exists, but current Windows path expects `libfftw3f` runtime semantics and must be replaced or extended for static linkage | No existing FPC binding in this repo; transform API is broader, integration path still unproven | FFTW |
| **Why not decisive alone** | GPL no longer blocks `SpectrumCore` at product level, but current DLL-oriented path fails the new shipping gate until static linkage is proven | Broader transform coverage is valuable, but does not outweigh missing spectral query advantage and heavier static integration cost | FFTW |

**Conclusion**: prefer `FFTW` when the product's primary need is a queryable spectral-analysis worker. Prefer `AVTX` only if broader transform-family coverage materially improves the shipped feature set without weakening the same worker/query contract.

---

## Candidate Role Summary

| Candidate | Role | Current standing |
|---|---|---|
| **A — FFTW** | Primary spectral core candidate | Preferred direction |
| **B — uos TFFT** | Technical probe / historical fallback only | Demoted from primary path |
| **C — FFmpeg/libavutil AVTX** | Auxiliary transform backend, possible future co-backend | Retained |
| **D — Audacity** | Reference semantics / parity source | Retained as reference only |

---

## Remaining Gates

- **Worker-contract gate**: baseline proof is now closed for `open-analysis`, `get-tile`, `point-query`, `area-query`, `close-analysis`, and `quit` with saved evidence. If editing feedback remains in scope, add `mark-dirty-range` and `recompute-range` proof as a separate gate.
- **Parity gate**: save agreed Audacity and FFmpeg reference outputs/observations for the shared fixtures, then compare SpectrumCore outputs against them. Initial `test_sine440` FFTW baseline and FFmpeg raster references now exist; Audacity capture is still pending.
- **Reproducibility gate**: local FFmpeg/Audacity trees still need immutable archive provenance and key-file hashes in addition to filesystem paths.
- **FFTW static-link gate**: baseline probe closure is now green; the worker uses the product-local native static binding and validates without external FFTW runtime DLL dependency.
- **AVTX static-link/value gate**: prove both that broader transform-family coverage materially helps product capability and that the required FFmpeg subset can be linked as objects/static libs into the same monolithic exe.

---

## Remediation Checklist

1. Capture immutable provenance for all four candidates in `versions.md`: git revision where available, otherwise archive/source origin plus SHA256 of key probe files.
2. Finalize the worker protocol contract: `open-analysis`, `get-tile`, `point-query`, `area-query`, `close-analysis`; if editing feedback stays in scope, add `mark-dirty-range` and `recompute-range`.
3. Preserve the validated FFTW worker evidence and use it as the anchor for parity/reference comparisons rather than reopening the old DLL-oriented probe path.
4. Extend the validated FFTW analysis model only where it improves the queryable contract, such as additional data modes or richer tile/view projections, without changing the canonical worker-owned store.
5. Build an AVTX probe focused on two questions: whether `MDCT/DCT/DST` coverage materially improves planned capabilities and whether the required FFmpeg subset can be statically linked into the same exe.
6. Generate and store Audacity reference outputs/observations for the agreed fixtures.
7. Compare current SpectrumCore outputs against the parity baseline on peak bin, chirp trajectory, impulse/transient behavior, deterministic output, and query responses.
8. Keep `uos` only as probe/reference unless a later decision explicitly reopens it.

---

## Candidate Rationales

### Candidate A — FFTW

**Why preferred now**

- Best fit for a worker whose core responsibility is a **queryable spectral-analysis pipeline**.
- Lets the product own the canonical STFT store, bin mapping, point queries, area queries, and future edit feedback logic.
- Existing FPC binding reduced initial adapter friction relative to AVTX, but the validated product path now uses a local static-oriented binding instead of the old DLL-oriented package unit.
- The legacy vendor unit `fftw_s.pas` is still DLL/import-oriented on Windows (`external fftwlib name ...`) and should be treated as historical context rather than the shipping path.

**What FFTW still does not solve**

- It remains only a transform primitive layer.
- The validated worker probe now satisfies the monolithic static-link requirement for the FFTW backend slice on Windows x64.
- The remaining FFTW work is no longer linkage proof; it is closing parity/reference evidence and extending queryable analysis semantics without breaking the canonical worker-owned model.
- The product-local Pascal binding dedicated to the static/object-link path is now the validated route, rather than the old FPC package unit.
- All higher spectral semantics still belong in product code.

### Candidate C — FFmpeg/libavutil AVTX

**Why retained**

- Stronger transform-family breadth than FFTW alone.
- Good candidate for future expansion if the product needs `MDCT/DCT/DST` in addition to spectral analysis.
- The transform-layer reuse itself is already technically proven in SpectrumCore/lib through the vendored `tx` subset, static bridge, Pascal backend, and kernel tests.

**Why not primary yet**

- Transform breadth does not automatically help the core spectrogram query/edit contract.
- The same queryable worker-side analysis store would still need to be built above AVTX.
- No existing FPC binding or validated minimal static-link integration path exists in this repo.
- No concrete user-facing worker command or product feature depends on AVTX yet, so its product-value gate remains open even though the auxiliary transform layer already works.

### Candidate B — uos TFFT

**Why demoted**

- No longer wins on product-level licensing posture, because `SpectrumCore` itself is now GPL.
- Offers less strategic value than FFTW in the new FFTW-vs-AVTX decision path.
- Provenance/licensing ambiguity remains unresolved.

`uos` can still exist as a technical probe or historical fallback note, but it is no longer the preferred direction.

### Candidate D — Audacity

**Why retained only as reference**

- Still the best parity/semantics reference for `frequencies`, `reassignment`, `pitch`, and settings behavior.
- Still lacks a proven narrow headless extraction boundary suitable for shipping integration.

---

## Impact On Implementation Plan

- The canonical product shape becomes: **standalone GPL CLI worker** with a documented JSON protocol and a single monolithic exe for shipping.
- The worker owns the canonical analysis store and query model; backend libraries must adapt to that model, not define it.
- **Phase 1**: stabilize worker protocol and canonical spectral frame representation.
- **Phase 2**: extend the FFTW-backed spectral core from validated magnitude/tile/point/area support toward additional queryable analysis modes, while keeping the same worker-owned canonical store.
- **Phase 3**: use Audacity and FFmpeg artifacts as parity/reference evidence.
- **Phase 4**: add optional AVTX adapter only if transform-family breadth materially improves the planned product.
- If FFTW static linkage proves unacceptable, the fallback should be **AVTX under the same worker/query model**, not a return to `uos` as the default path.

---

## Rejection / Non-Primary Notes

- **Raster-only FFmpeg paths** remain reference-only. They do not satisfy the primary query/edit contract.
- **Direct Audacity reuse** remains non-primary until a narrow headless boundary is proven.
- **uos** remains non-primary because its old advantage depended on assumptions that are no longer controlling and because provenance is still unresolved.

---

## Next Actions

1. Use the validated FFTW worker proof as the baseline artifact for parity/reference work.
2. Extend the FFTW-backed analysis model only where it strengthens the query contract, starting with additional data modes or richer tile/view semantics.
3. Produce an AVTX-focused probe that answers two questions only: does broader transform-family coverage materially improve planned product capability, and can the needed subset be statically linked into the same exe?
4. Finish immutable source pinning for FFmpeg/Audacity local trees by capturing archive provenance plus key-file hashes.
5. Capture Audacity baseline artifacts per fixture: raster/screenshot, exact effective settings, point/area observations, source hash, build identifier.
6. Capture FFmpeg reference artifacts per fixture: exact CLI, output raster, stdout/stderr log.
7. Save SpectrumCore outputs for the same settings tuples and classify each comparison as `match`, `close-enough`, `mismatch`, or `not-comparable`.
