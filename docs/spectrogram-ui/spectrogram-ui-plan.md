# Spectrogram UI Plan (Audacity-style, on the SpectrumCore worker)

Status: **active**
Created: 2026-06-25
Authoritative progress ledger: [spectrogram-ui-progress.json](spectrogram-ui-progress.json)

Goal: a full **Audacity-style spectrogram view** on the Audio tab (with a time slider like
the schedule player), rendered by the UI on top of the **SpectrumCore** compute core. The
backend now has **full ffmpeg `showspectrumpic` + Audacity parity** (frequency scales
lin/log/mel/bark/erb/period, data magnitude/phase/uphase/reassign/pitch, gain/range/
frequencyGain, window + zero-padding, the full window set incl. Gaussians, start/stop,
combined/separate). This plan builds the **UI + server bridge** that exposes all of it.

Prerequisite (met): [SpectrumCore/cli/spec/audacity-parity-plan.md](../../../SpectrumCore/cli/spec/audacity-parity-plan.md)
(complete) and the showspectrum compute core + worker follow-on.

## 1. Where things live (today)

- **UI:** Quasar (Vue 3 + TS). The Audio tab is [GnauralCore/ui/pages/AudioPage.vue](../../ui/pages/AudioPage.vue);
  MindWaveCore re-exports it. The current spectrogram
  [GnauralCore/ui/components/SpectrogramView.vue](../../ui/components/SpectrogramView.vue)
  is a **placeholder** computing Goertzel client-side from an `AudioBuffer` — to be replaced.
- **Server:** MindWaveCore/server (bun) is the runtime host with WS handlers; it imports the
  audio domain from GnauralCore/server. Audio files are server-side (a `filePath` exists for
  the selected track; WAV export is available).
- **Compute:** `SpectrumCoreFftwWorkerProbe` (native, JSON over stdio): `open-analysis`,
  `get-tile` (frame or `(timeStart,timeEnd,zoom)` + overview pyramid + budgeted cache),
  `point-query`, `area-query`, `export-matrix`, `close-analysis`.

## 2. Architecture (DU1) — live worker over WebSocket

```
GnauralCore/ui (Vue/Quasar)
  SpectrogramView.vue   canvas tiles + axes + time slider + hover/selection
  useSpectrogram.ts     open -> get-tile(time,zoom) -> client cache -> render
  spectrogram store     full settings (all backend params) + view state
        |  WebSocket (additive message types)
        v
MindWaveCore/server (bun)  +  GnauralCore/server (audio domain)
  spectrogram-bridge    Bun.spawn the worker, NDJSON framing, req/resp correlation,
                         lifecycle/restart, exe path from config/ENV (dev-only, DU3)
  audio source          WAV path for the selected track; non-WAV -> temp WAV (existing export)
        |  stdin/stdout JSON
        v
SpectrumCoreFftwWorkerProbe.exe
```

**Render split (DU5):** fetch **linear-magnitude** tiles; apply `scale/gain/drange/limit/
saturation/palette` in the renderer (live, no refetch). Re-analysis (worker reconfigure)
only for `window/hop/overlap/win_func/data/fscale/zero-padding/mode/channel/start/stop`.

## 3. Locked decisions

See ledger `decisions` (DU1–DU9). Highlights: live worker over WS (DU1); code in
GnauralCore/ui + server, re-exported (DU2); worker exe dev-only via config/ENV (DU3); the
UI must surface the **full** backend capability set, coverage is an acceptance criterion
(DU4); render-only vs reconfigure split (DU5); reuse the schedule-player slider if
sufficient else adapt (DU6); plan + ledger, per-step atomic commits, no push, phase-boundary
review pauses (DU7); gates = vue-tsc + lint + bun bridge-contract (primary) + vitest +
manual visual (DU8).

## 4. Acceptance / gates (DU8)

`PASS = vue-tsc (typecheck) AND lint AND bun bridge-contract (spawn worker on a fixture;
tile/point/area shapes; reconfigure; crash-restart) AND vitest (composable/store logic)`.
Visual parity vs Audacity/ffmpeg references is **manual / non-blocking** (same D6 spirit as
the backend). The capability-coverage matrix (U4.3) is a hard acceptance item.

## 5. Risks

- **Cross-process bridge** (bun ↔ native worker): framing/backpressure/crash-restart — the
  bridge contract test is the guard.
- **Audio format**: the worker reads WAV; non-WAV needs conversion (U1.2).
- **Render performance** at high zoom / many tiles: client cache + cancellation + the
  worker's budgeted tile cache; ImageData blits.
- **Time-slider reuse** uncertain (DU6) — U3.2 evaluates before building.
- **Worker distribution** is out of scope now (dev-only, DU3); packaging is a later plan.

## 6. Steps (checklist mirrors the ledger)

**Phase 0 — Plan & protocol**
- [x] **U0.1 — Plan & ledger.** This document + [spectrogram-ui-progress.json](spectrogram-ui-progress.json).
- [ ] **U0.2 — WS protocol + bridge skeleton + smoke harness.** Additive WS message types;
  a `spectrogram-bridge` skeleton that spawns the worker on a fixture, opens, fetches one
  tile, asserts shape; bun smoke test.

**Phase 1 — Server worker bridge**
- [ ] **U1.1 — Worker process manager.** Bun.spawn (exe from config/ENV), NDJSON framing,
  req/resp correlation, timeout + crash-restart, clean shutdown.
- [ ] **U1.2 — Audio source resolution.** WAV path for the selected track; non-WAV → temp
  WAV via existing export; cache + cleanup.
- [ ] **U1.3 — WS endpoints.** Per-connection session: open/reconfigure/get-tile/point-query/
  area-query/close; bun contract test green.

**Phase 2 — Core rendering**
- [ ] **U2.1 — useSpectrogram composable.** Tile fetch for visible (time,zoom) + client
  cache + debounced refetch + cancellation.
- [ ] **U2.2 — Canvas tile renderer.** float → palette → ImageData; fscale-aware frequency
  axis; replaces the Goertzel placeholder.
- [ ] **U2.3 — Palettes + client value transform.** scale/gain/drange/limit/saturation/
  palette applied live on linear tiles.

**Phase 3 — Navigation**
- [ ] **U3.1 — Frequency axis + time ruler** (the chrome the backend omits).
- [ ] **U3.2 — Time slider + zoom/pan.** Evaluate/reuse the schedule-player slider (DU6);
  drive get-tile by (timeStart,timeEnd,zoom) across pyramid tiers.
- [ ] **U3.3 — Playhead sync** with transport (optional/non-blocking).

**Phase 4 — Full parameter panel**
- [ ] **U4.1 — Settings panel** exposing every backend parameter (DU4); bound to a pinia store.
- [ ] **U4.2 — Apply semantics + persistence.** render-only vs reconfigure split (DU5);
  persist settings (localStorage).
- [ ] **U4.3 — Capability-coverage + presets.** Coverage matrix (every option reachable) +
  Audacity / ffmpeg default presets.

**Phase 5 — Interaction + polish**
- [ ] **U5.1 — Hover readout** (time/freq/intensity) via point-query (throttled).
- [ ] **U5.2 — Area selection → area-query** (peak/mean overlay).
- [ ] **U5.3 — i18n / a11y / states / perf + final acceptance** (all gates green; plan
  status = complete).

## 7. References

- Audacity Spectrogram View — <https://manual.audacityteam.org/man/spectrogram_view.html>
- ffmpeg showspectrumpic — <https://ffmpeg.org/ffmpeg-filters.html#showspectrumpic>
- Worker contract — [SpectrumCore/cli/spec/fftw-worker-probe-contract.md](../../../SpectrumCore/cli/spec/fftw-worker-probe-contract.md)
- One-shot contract — [SpectrumCore/cli/spec/cli-contract.md](../../../SpectrumCore/cli/spec/cli-contract.md)
- Backend parity final status — [SpectrumCore/cli/spec/audacity-parity-final-status.md](../../../SpectrumCore/cli/spec/audacity-parity-final-status.md)
- Worker follow-on (tiling/cache/export) — [SpectrumCore/cli/spec/worker-integration-plan.md](../../../SpectrumCore/cli/spec/worker-integration-plan.md)
