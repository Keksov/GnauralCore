# Spectrogram UI — capability coverage (DU4)

Hard-acceptance matrix (U4.3): every SpectrumCore option is reachable from the UI. The
settings live in `ui/stores/spectrogram.ts` (defaults + lists in
`ui/composables/spectrogram-settings.ts`), exposed by `SpectrogramSettingsPanel.vue`. Apply
class follows the render-only vs reconfigure split (DU5): **render** = client-side, live, no
re-analysis; **reconfigure** = worker re-analysis (debounced).

| Backend capability | Setting | UI control | Apply |
|---|---|---|---|
| window size | `window` | select (256–16384) | reconfigure |
| zero-padding factor | `zeroPaddingFactor` | select (1/2/4×) | reconfigure |
| hop size | `hop` | number | reconfigure |
| overlap | `overlap` | slider 0–0.95 | reconfigure |
| channel index | `channel` | number | reconfigure |
| window function (incl. gauss25/35/45) | `winFunc` | select (full list) | reconfigure |
| data mode (magnitude/phase/uphase/reassign/pitch) | `data` | select | reconfigure |
| frequency scale (lin/log/mel/bark/erb/period) | `fscale` | select | reconfigure |
| start frequency | `startHz` | number | reconfigure |
| stop frequency (0 = Nyquist) | `stopHz` | number | reconfigure |
| channel mode (combined/separate) | `mode` | select | reconfigure |
| intensity scale (lin/sqrt/cbrt/log/4thrt/5thrt) | `scale` | select | render |
| gain | `gain` | slider | render |
| frequency gain (dB/decade) | `frequencyGain` | slider | render (per-bin) |
| dynamic range (dB) | `drange` | slider | render |
| limit (dB) | `limit` | slider | render |
| saturation | `saturation` | slider | render (palette stage) |
| palette (intensity/rainbow) | `palette` | select | render |

Notes:
- The split is verified by `toRenderOptions` / `toAnalysisParams` (unit-tested) — render keys
  never leak into the worker analysis params.
- `frequencyGain` is applied client-side per display bin (via `binFrequenciesHz`), so it is
  render-only here rather than a worker reconfigure.
- Raster-only `showspectrumpic` options (`size`, `slide`, `rotation`, `legend`, `opacity`,
  `fps`, `color` beyond intensity/rainbow) are intentionally out of scope (same as the
  worker contract).

## Presets

- **Audacity** — `fscale=log`, `scale=log`, `winFunc=hann`, `window=2048`, `drange=80`.
- **ffmpeg showspectrumpic** — `fscale=lin`, `scale=sqrt`, `winFunc=hann`, `overlap=0`,
  `drange=120`.

Defined in `SPECTROGRAM_PRESETS` (spectrogram-settings.ts), applied via the store's
`applyPreset(name)` from the panel's **Presets** menu. Both round-trip cleanly through the
persistence validator (tested).
