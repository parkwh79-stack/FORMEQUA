# Shared mass profiles and Manifold display solids

Implemented 2026-11-02. Existing A/B/C presets remain available. Their default profile is `legacy`; the additional profiles are `chamfered`, `tapered` and `stepped` (three-storey groups). `massShapePct` ranges from 0 to 30. `crownStyle` is `flat` or `sloped`; `crownHeightM` ranges from 0 to 8 metres.

## Geometry contract

`floor-geometry.js` supplies per-storey convex outer contours and optional rectangular atrium holes in building-local X/Z metres. Y is height. Each floor has a stable `floorId`. Floor area is the signed polygon area less holes; chamfered corners remove two times the squared cut distance. The building footprint uses the union of all storeys' outer horizontal projections, with a fast path when the first floor contains all upper floors. Taper/setbacks are applied before existing site/solar/height/area/core/parking checks. Shape changes do not replace the legal or site inputs.

WebGL slabs, façade edges, plan outlines and IFC floor/roof slabs use these contours. IFC X=model X, Y=-model Z, Z=height. Interior rooms and the continuous core use a conservative inscribed rectangle for chamfered floors. The residual perimeter zone is unplanned; the plan warns about this limitation. Existing rectangular room-generation methods have not become arbitrary polygon solvers. Common structural axes are only reference lines; they are filtered against all storeys and do not establish structural safety.

## Manifold boundary

Pinned `manifold-3d@3.5.4`, source commit `ce50d78021d64507f89e8c9fc2c2e51018117857`, Apache-2.0. Official npm distribution SHA512 integrity is verified before vendoring; exact hashes are recorded in `vendor/manifold/provenance.json`. No external runtime download or image/LLM API is used.

The module worker receives geometry only. The adapter maps X/Z to Manifold X/-Y and height to Z, extrudes each contour, and optionally clips a rooftop crown by a plane. All WASM objects are explicitly deleted. Results are typed position/index arrays; the Three.js adapter replaces display buffers. Work is debounced, bounded to one active plus the latest pending job, cached by geometry, and protected against stale scene results. Until a job completes, or if WASM fails, the canonical contour extrusion remains visible. Finance and sensitivity calculations never await or execute WASM. The actual WebGL buffer can therefore be rebuilt without changing quantities.

## Roof scope

A sloped crown is a **nonoccupiable conceptual roof screen**, not extra floor space. The whole crown plus roof slab is reserved in the study height. It excludes rooftop PV. Its structural design, wind loads, statutory height interpretation and incremental construction costs require separate review. IFC currently exports the matching floor and roof slabs and core reservations; the crown, detailed façade and interiors are outside that conceptual IFC export scope. Do not describe this as a permit-ready or structurally verified BIM model.

## Compatibility and security

Missing settings default to legacy geometry and a flat roof; project version 1 remains importable. API validation, workspace save/import, hotel cache keys and UI requests include geometry inputs. The exterior/material tab remains the initial tab. Model-only public access and contact-only workbench routing are unchanged; private API authentication and disabled production review storage remain in force.

Only the exact vendored WASM path is statically allowed. CSP permits WebAssembly compilation through `wasm-unsafe-eval`, not JavaScript `unsafe-eval`; module workers are same-origin. The release allowlist contains the runtime, adapter, worker and license, excluding package metadata from the hosted web package.

## Future work

Curved/elliptical floors, twist, arbitrary voids/booleans, true polygon room planning and structural/MEP design are not enabled in this version. Add them only after extending the same floor/area/core/plan/export contracts. Manifold subdivision count is not a storey count.
