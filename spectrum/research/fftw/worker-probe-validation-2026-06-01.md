# FFTW Worker Probe Validation

Date: 2026-06-01
Updated: 2026-06-02
Status: validated
Scope: native-static FFTW worker proof for the analytics-first JSON contract

## Build

Command:

```bat
cd /d c:\projects\KKMindWave\SpectrumCore\cli
build_fftw_worker_probe_x64.bat
```

Result:

```text
Build succeeded: build\x64\SpectrumCoreFftwWorkerProbe.exe
```

## Session Fixture

- Worker: `c:\projects\KKMindWave\SpectrumCore\cli\build\x64\SpectrumCoreFftwWorkerProbe.exe`
- Input fixture: `c:\projects\KKMindWave\SpectrumCore\cli\build\x64\test_sine440.wav`
- Analysis config:
  - `window=2048`
  - `hop=512`
  - `overlap=0.75`
  - `win_func=hann`
  - `data=magnitude`
  - `fscale=log`
  - `start=80`
  - `stop=4000`
  - `gain=1`
  - `drange=120`
  - `limit=0`

## Request / Response Transcript

Request:

```json
{"cmd":"open-analysis","analysisId":"sine","input":"build\\x64\\test_sine440.wav","window":2048,"hop":512,"channel":0,"overlap":0.75,"win_func":"hann","data":"magnitude","fscale":"log","start":80.0,"stop":4000.0,"gain":1.0,"drange":120.0,"limit":0.0}
```

Response:

```json
{"ok":true,"cmd":"open-analysis","analysisId":"sine","sampleRate":44100,"windowSize":2048,"hopSize":512,"overlap":0.750000,"windowFunc":"hann","data":"magnitude","fscale":"log","startHz":80.000000,"stopHz":4000.000000,"gain":1.000000,"drange":120.000000,"limit":0.000000,"binding":"native-static","frameCount":83,"binCount":1025,"durationS":1.000000}
```

Request:

```json
{"cmd":"get-tile","analysisId":"sine","frameStart":40,"frameCount":2,"viewBinCount":16}
```

Response:

```json
{"ok":true,"cmd":"get-tile","analysisId":"sine","frameStart":40,"frameCount":2,"binStart":3,"binCount":16,"sourceBinCount":184,"data":"magnitude","fscale":"log","viewStartHz":80.000000,"viewStopHz":4000.000000,"binFrequenciesHz":[80.000000,103.837603,134.778097,174.937932,227.064194,294.722520,382.541000,496.526756,644.476851,836.511642,1085.767047,1409.293093,1829.220208,2374.273020,3081.735238,4000.000000],"frames":[{"frameIndex":40,"timeSec":0.487619,"bins":[0.000026,0.000034,0.000049,0.000079,0.000161,0.000529,0.010930,0.010442,0.000186,0.000026,0.000006,0.000002,0.000001,0.000000,0.000000,0.000000]},{"frameIndex":41,"timeSec":0.499229,"bins":[0.000040,0.000046,0.000059,0.000088,0.000167,0.000534,0.010934,0.010440,0.000184,0.000025,0.000006,0.000002,0.000001,0.000000,0.000000,0.000000]}]}
```

Request:

```json
{"cmd":"point-query","analysisId":"sine","timeSec":0.50,"frequencyHz":440.0}
```

Response:

```json
{"ok":true,"cmd":"point-query","analysisId":"sine","frameIndex":41,"binIndex":20,"frameTimeSec":0.499229,"binHz":430.664063,"value":0.442239,"magnitude":0.442239,"db":-7.086859,"displayDb":-7.086859,"normalized":0.940943,"phase":2.580945,"unwrappedPhase":2.580945}
```

Request:

```json
{"cmd":"area-query","analysisId":"sine","timeStartSec":0.45,"timeEndSec":0.55,"freqStartHz":400.0,"freqEndHz":500.0}
```

Response:

```json
{"ok":true,"cmd":"area-query","analysisId":"sine","frameStart":37,"frameEnd":45,"binStart":19,"binEnd":23,"cellCount":45,"meanValue":0.205826,"meanMagnitude":0.205826,"peakValue":0.442242,"maxMagnitude":0.442242,"maxDb":-7.086802,"peakDisplayDb":-7.086802,"peakNormalized":0.940943,"peakPhase":-1.659130,"peakUnwrappedPhase":-1.659130,"peakFrameIndex":44,"peakBinIndex":20,"peakTimeSec":0.534059,"peakFreqHz":430.664063}
```

Request:

```json
{"cmd":"close-analysis","analysisId":"sine"}
{"cmd":"quit"}
```

Response:

```json
{"ok":true,"cmd":"close-analysis","analysisId":"sine"}
{"ok":true,"cmd":"quit"}
```

## Conclusions

- The worker starts and answers requests without `libfftw3f.dll`; binding mode is `native-static`.
- The analytics-first contract is live for `open-analysis`, `get-tile`, `point-query`, `area-query`, `close-analysis`, and `quit`.
- `fscale=log` is no longer metadata-only for tile requests: `get-tile` returns `binFrequenciesHz` and mode-aware values projected onto that display frequency map.
- Point and area queries keep magnitude-derived fields stable while also exposing `value`, `phase`, and `unwrappedPhase` from the same canonical FFT frame store.
- Separate live sessions now validate `data=phase` and `data=uphase` on the same worker-owned store; the peak sine bin still resolves at frame `41`, bin `20`, while mode-aware tile values change as expected.
- A separate live session now validates `data=reassign` on the same worker-owned store: at frame `41`, bin `20`, canonical `magnitude` stayed `0.442239` while mode-aware `value` rose to `0.612354`, and the narrow tile `[18..23]` collapsed to `[0.000068,0.000137,0.612354,0.000376,0.000009,0.000009]`.
- After the reassignment peak-semantics fix, `area-query` over frames `37..45` and bins `19..23` now resolves the peak at frame `41`, bin `20` with `peakValue=0.612354`, while canonical summary fields remain `maxMagnitude=0.442242` and `maxDb=-7.086802`.
- A separate live session also validates `frequencyGain=10` as a display-only transform: at the same sine peak, canonical `magnitude` stayed `0.442239` and raw `db` stayed `-7.086859`, while `displayDb` shifted to `-10.745472` and `normalized` to `0.910454`.
- Two overlapping `get-tile` calls (`frameStart=37,frameCount=8` then `frameStart=38,frameCount=8`) also completed successfully after the viewport-cache integration, exercising the product-local reuse path without changing returned values for the shared rows.
- A separate live session now validates the first worker-visible AVTX hook: `aux-transform mdct-forward` returned `[-1.726000,1.596328,-2.757174,-0.526216]`, and `aux-transform imdct-full` returned `[0.027699,0.953362,-0.953362,-0.027699,-0.689141,-0.230040,-0.230040,-0.689141]` with `backend="avtx"`, `role="auxiliary"`, `bridgeVersion="avtx-bridge-tx-subset-3"`, and `apiLevel=5`.
- A follow-up live session also validates parser variants on the same command: `aux-transform dct-forward` returned `[2.500000,-2.804468,3.889087,1.544332]`, and `aux-transform mdct-inverse` with `fullOutput=true` returned the same 8-sample full IMDCT output while echoing `effectiveFlags:["full-output"]`.
- A separate live session now validates a higher-level AVTX path, `mdct-edit-preview`: with the original 8-sample PCM block it returned the MDCT coefficients `[-1.726000,1.596328,-2.757174,-0.526216]` plus full IMDCT preview `[-1.750000,-1.500000,1.500000,1.750000,-0.625000,1.000000,1.000000,-0.625000]`; with `gain=0.0`, the same command returned zeroed edited coefficients, zeroed preview samples, `peakAbs=0.000000`, and `rms=0.000000`.
- Another live session validated coefficient-band editing on that same command: `muteStart=1,muteCount=2` changed the edited coefficients to `[-1.726000,0.000000,0.000000,-0.526216]` and produced preview samples `[-0.698223,0.089689,-0.089689,0.698223,0.571383,0.897748,0.897748,0.571383]`.
- A follow-up live session now validates that the same command is connected to the real FFTW analysis flow rather than only to ad hoc sample arrays: after `open-analysis` on `test_sine440.wav`, `mdct-edit-preview` with `analysisId="sine"`, `timeSec=0.50`, and `sampleCount=8` resolved `frameIndex=41`, `frameTimeSec=0.499229`, and `sampleStart=22012`.
- Repeating that analysis-coupled request with `gain=0.0` returned zeroed edited coefficients and zeroed preview samples, confirming that the AVTX preview/resynthesis path now runs directly on a window sourced from the active worker analysis session.

Request:

```json
{"cmd":"mdct-edit-preview-range","analysisId":"sine","timeStartSec":0.49,"timeEndSec":0.51,"sampleCount":8}
```

Response excerpt:

```json
{"ok":true,"cmd":"mdct-edit-preview-range","sourceMode":"analysis-range","analysisId":"sine","frameStart":40,"frameEnd":42,"frameStep":1,"sampleCount":8,"itemCount":3,"maxPeakAbs":1.953156,"meanRms":1.075802,"items":[{"frameIndex":40,"sampleStart":21500,"coefficients":[1.599715,0.307243,-0.258463,-0.200844],"peakAbs":0.820831,"rms":0.587434},{"frameIndex":41,"sampleStart":22012,"coefficients":[3.306162,0.993523,-0.693905,-0.577425],"peakAbs":1.785278,"rms":1.261582},{"frameIndex":42,"sampleStart":22524,"coefficients":[3.537474,1.236496,-0.819768,-0.696404],"peakAbs":1.953156,"rms":1.378389}]}
```

Request:

```json
{"cmd":"mdct-edit-preview-range","analysisId":"sine","timeStartSec":0.49,"timeEndSec":0.51,"sampleCount":8,"gain":0.0}
```

Response excerpt:

```json
{"ok":true,"cmd":"mdct-edit-preview-range","sourceMode":"analysis-range","analysisId":"sine","frameStart":40,"frameEnd":42,"frameStep":1,"sampleCount":8,"itemCount":3,"gain":0.0,"maxPeakAbs":0.000000,"meanRms":0.000000,"items":[{"frameIndex":40,"editedCoefficients":[0.000000,0.000000,0.000000,0.000000],"previewSamples":[0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000],"peakAbs":0.000000,"rms":0.000000},{"frameIndex":41,"editedCoefficients":[0.000000,0.000000,0.000000,0.000000],"previewSamples":[0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000],"peakAbs":0.000000,"rms":0.000000},{"frameIndex":42,"editedCoefficients":[0.000000,0.000000,0.000000,0.000000],"previewSamples":[0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000],"peakAbs":0.000000,"rms":0.000000}]}
```

## Additional Conclusions

- The worker now validates `mdct-edit-preview-range` as the first analysis-range AVTX preview flow on top of the FFTW-owned canonical store.
- A time-selected request over `0.49..0.51 s` resolved to frames `40..42` with per-frame coefficient previews and aggregate `maxPeakAbs=1.953156`, `meanRms=1.075802`.
- Repeating the same range request with `gain=0.0` zeroed every emitted frame item, which confirms that the per-frame edit/resynthesis loop reuses the same coefficient edit controls as the single-window path.
