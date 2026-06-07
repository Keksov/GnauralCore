# Current Local Reference Tree Provenance

Date: 2026-06-04
Status: current local FFmpeg and Audacity provenance pinned for the saved parity baseline

## Scope

- Vendored FFmpeg full-source tree used for the local `ffmpeg.exe` and `ffprobe.exe` build.
- Vendored Audacity donor tree used for source-level spectrogram semantics checks.
- Workspace-built Audacity runtime used for saved and future reference captures.

## FFmpeg Vendored Source Tree

- Path: `c:\projects\KKMindWave\SpectrumCore\lib\vendor\FFmpeg`
- Git remote: `https://github.com/FFmpeg/FFmpeg.git`
- Git revision: `bf608f16fd6772b1977a2637e8ab49644f6b5eb5`
- Working tree status: `clean`
- Version marker from `RELEASE`: `8.0.git`
- Key-file SHA256:
  - `README.md`: `7E30F809D40454EBC467CF473A063D7306F5EB836DCA6B80668C4427D8845914`
  - `LICENSE.md`: `2E1D16C72FD74E12063776371DA757322F8B77589386532F4FD8634BDE7DE1AF`
  - `RELEASE`: `EC416D91D2C97CDD5792600AB6A97D60B754ED2FF77CA816D4C18B8500A3A8D8`

Built runtime already pinned by the comparison stack:

- `ffmpeg.exe`: `8D79A3B81DE3F741BBED1D4676EB8096B01D0529BABE576B61F05D066E28F29B`
- `ffprobe.exe`: `197EE91C680CD2797AE07F15444244AFA22F275611D6EC3F1ACB1026A001357B`

## Audacity Vendored Donor Tree

- Path: `c:\projects\KKMindWave\SpectrumCore\lib\vendor\audacity`
- Git remote: `https://github.com/audacity/audacity.git`
- Git revision: `716c5ff1235989cdb47e754f2ce1583fb8944572`
- Working tree status: `clean`
- Version marker from `version.cmake`: `4.0.0`
- Version flags from `version.cmake`: `MUSE_APP_UNSTABLE=ON`, `MUSE_APP_IS_PRERELEASE=ON`
- Audacity `muse` submodule pin: `3e3d513e2161b4fa62bdc52800b7c49f21b33b93`
- Audacity `muse` submodule URL: `https://github.com/musescore/muse_framework.git`
- Key-file SHA256:
  - `README.md`: `39F91A3415F83AD499014B1D83E45965990CE4D67342AACE9D72E4471E3B4E05`
  - `LICENSE.txt`: `1580FFB4A0C6BBB716324C645682964120EAE418B9A1C51842CDA140343CB139`
  - `version.cmake`: `E14E2FF602389812B00642FDEF71E0FA8CC1DCDD827561EDD74FDE0C94BE264F`

## Workspace Audacity Capture Runtime

Current capture runs should use the workspace-relative runtime below.

- Runtime path (workspace-relative): `SpectrumCore/lib/build/audacity-win64/install/bin/Audacity4.exe`
- Runtime file version: `4.0.0`
- Runtime SHA256: `90C708BE394A76E04B74425FF393B27728F14011634552B58CB59BFBA2640E4B`
- Script module path: `not pinned in install tree (mod-script-pipe.dll not found during this update)`
- Script module SHA256: `n/a`

## Provenance Conclusion

- The current local FFmpeg source-tree provenance is now pinned by git revision, remote URL, clean working-tree status, key-file hashes, and the built binary hashes already used by the reference packs.
- The current local Audacity donor-tree provenance is now pinned by git revision, remote URL, clean working-tree status, submodule pin, and key-file hashes.
- The workspace Audacity4 capture runtime is hash-pinned, so the saved reference packs can now be tied to an exact binary identity.
- This closes the current local-tree provenance gap for the saved parity baseline.
- This does not imply source-to-binary equivalence for historical external runtimes, and it does not recreate the missing historical external trees.