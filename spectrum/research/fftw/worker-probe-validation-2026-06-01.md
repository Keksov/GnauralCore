# FFTW Worker Probe Validation

Date: 2026-06-01
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
- A separate live session also validates `frequencyGain=10` as a display-only transform: at the same sine peak, canonical `magnitude` stayed `0.442239` and raw `db` stayed `-7.086859`, while `displayDb` shifted to `-10.745472` and `normalized` to `0.910454`.
