# Final R5A Strict Parity Baseline

Date: 2026-06-04
Status: archived current strict parity baseline

## Scope

This archive freezes the current canonical R5A SpectrumCore comparison-pack set after the strict multi-mode refresh.

- Fixture set: `sine440_1s_mono_44k`, `multitone_440_880_1760_2s`, `chirp_20_8000_3s`, `impulse_train_2s`, `silence_1s`, `melodic_contour_pitch_eac_4s`, `transient_burst_reassignment_2s`
- Worker modes covered in every canonical pack: `magnitude`, `phase`, `uphase`
- Summary verdict for the archived set: `match` on all seven canonical fixtures
- Canonical sine path: `c:\projects\KKMindWave\GnauralCore\spectrum\research\comparison\sine440_1s_mono_44k`
- Historical alias retained for provenance only: `c:\projects\KKMindWave\GnauralCore\spectrum\research\comparison\test_sine440`

Supporting provenance for the source trees and installed Audacity runtime is pinned in `reference-source-provenance-2026-06-04.md`.

## Archived Comparison Pack Index

- `sine440_1s_mono_44k`: summary `match`, modes `match/match/match`, phase-vs-uphase delta `31.415927`
  - `manifest.json`: `9EC22346EB5DB7282A3A81B7B7E4C0EA0F1EC191B45F831A9FF82C10FCED6C28`
  - `README.md`: `2808EFAB431C00C68FA5E0121E45DDF97D23996E0531C73F106EAE9D2593B012`
  - `session-transcript.jsonl`: `A41470FAC64B8E4AB731D694B12FB2E38622FEEB970F1FFDE04B17853223C1DC`
- `multitone_440_880_1760_2s`: summary `match`, modes `match/match/match`, phase-vs-uphase delta `25.132740`
  - `manifest.json`: `FC076726DE8C149E02751229FD686C54870FC784E559671FD95E162E5AB63DB6`
  - `README.md`: `9A76DA1E77B994ECB7D2A493BD3556B89C27242BA4169DF160549DF866ADA76E`
  - `session-transcript.jsonl`: `04D1FA281A59C55984FF250C1BD0F8BA68DB2A1D159CC3523553BB9F9EADCED9`
- `chirp_20_8000_3s`: summary `match`, modes `match/match/match`, phase-vs-uphase delta `18.849556`
  - `manifest.json`: `357FD5AAA2EAD84B793A3616F9D5B60A2C75169E53715A1A240C88905DFC9194`
  - `README.md`: `689C684B5EF2D4845B9953CBDD533871B9FF4EC23B1FBC904C4894820E166AA0`
  - `session-transcript.jsonl`: `279C8E3983BD556BB46BCE8C387D1839ED5F7BC068F5C0F514D31794DEDAF55D`
- `impulse_train_2s`: summary `match`, modes `match/match/match`, phase-vs-uphase delta `565.486678`
  - `manifest.json`: `11271D00686954AB5901068B3CF960845933B84BC075D3863ECD40F3778A62B0`
  - `README.md`: `A7CE27E9800606FFC6CE7CC6C24756640B400BEEFB83D44B804C0F9A2C1C8AD7`
  - `session-transcript.jsonl`: `1728F3BD438CB5465991BC769CCB9EC3E53B7B4EC5C77719A0B3EA2F88A903DB`
- `silence_1s`: summary `match`, modes `match/match/match`, phase-vs-uphase delta `0.000000`
  - `manifest.json`: `869CA05D98B1D8C092A4E2776C788811CB5053A0423B6416C2B813C5608242B5`
  - `README.md`: `383CCB3D44FBB25A6F00850CC8B3AAEF8A4FC6EA162DBFFB62AD43D96A7B56C5`
  - `session-transcript.jsonl`: `742644BE81ACA402AE68B48DBB53600E2ABD06880EDBD81975F8B1EFEA3DAEA2`
- `melodic_contour_pitch_eac_4s`: summary `match`, modes `match/match/match`, phase-vs-uphase delta `31.415927`
  - `manifest.json`: `E0B207F64F4ED91C3D68308FBE4EABFDFAEE41C5F95F79C8E4E29BC64D5E1055`
  - `README.md`: `9DC2D345D0B8CCA2DFE00332C06825787B07CCDCCE9D2142379DD1FFEE9904C7`
  - `session-transcript.jsonl`: `9E6E733790D48758584E1C5D4D599AB7075BB0E147F33CFF0AB5B7178311707B`
- `transient_burst_reassignment_2s`: summary `match`, modes `match/match/match`, phase-vs-uphase delta `515.221196`
  - `manifest.json`: `54910B1CD931ED088D9FD60D11D961331A0D766B75687224077FBABC27716A39`
  - `README.md`: `AB293E3897B7FCDFAABB1DF0770DDB0507E1A9C2F9A2B4072DF19B4F5A1BB3C1`
  - `session-transcript.jsonl`: `D2F1BFC518E18C6BC21AE34ACCB2E49E092B2E1B60DCC12E95388CFE965A7D44`

## Archive Rule

- Treat this file as the current accepted parity baseline for the canonical R5A set.
- Future regressions should compare against the saved comparison-pack manifests and transcripts listed above.
- If a later session intentionally rolls the baseline, create a new dated archive rather than mutating these hashes in place.