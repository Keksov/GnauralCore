# GnauralCore

Owned location for the extracted audio core product.

Current ownership:

- `cli`
- product-local Pascal audio vendor tree under `cli/vendor/uos`
- product-local Gnaural control protocol under `cli/common`
- `server`
- audio UI modules from `ui`

No compatibility shim remains under `pas/gnaural`.

UI composition contract:

- `ui/package.json` declares the source-level public entrypoints used by host products.
- The package root stays minimal and re-exports only `gnauralModule` and `createGnauralPlugin`; deeper access should go through declared subpath exports.
- `ui` exports `gnauralModule` for route, settings-tab, and locale-message contributions.
- `ui` exports `createGnauralPlugin` for runtime wiring; the host must provide the shared `ws` adapter before rendering Gnaural pages.
- Gnaural owns its module-local navigation namespace, including `nav.audio`.
- Host shells such as MindWaveCore own only shell concerns like top-level navigation, archive/log pages, and app bootstrap.
