# Shared mass profiles and Manifold display solids

Implemented 2026-11-02. Existing A/B/C presets remain available. Their default profile is `legacy`; the additional profiles are `chamfered`, `tapered`, `stepped` (three-storey groups), `elliptic`, `sculpted` and `twisted`. `massShapePct` ranges from 0 to 30. `crownStyle` is `flat` or `sloped`; `crownHeightM` ranges from 0 to 8 metres.

## Geometry contract

`floor-geometry.js` supplies per-storey convex outer contours and optional rectangular atrium holes in building-local X/Z metres. Y is height. Each floor has a stable `floorId`. Floor area is the signed polygon area less holes; chamfered corners remove two times the squared cut distance. The building footprint uses the union of all storeys' outer horizontal projections, with a fast path when the first floor contains all upper floors. Taper/setbacks are applied before existing site/solar/height/area/core/parking checks. Shape changes do not replace the legal or site inputs.

WebGL slabs, façade edges, plan outlines and IFC floor/roof slabs use these contours. IFC X=model X, Y=-model Z, Z=height. Interior rooms and corridors are clipped to the actual convex storey contour, inset 0.2 m for the exterior wall reserve. Curved and rotated perimeter portions belong to polygon rooms or open support spaces; they are not discarded as an inscribed-rectangle remainder. The continuous core still uses a shared safe inscribed region across every storey. Common structural axes are only reference lines; they are filtered against all storeys and do not establish structural safety.

## Sculptural studies

Three one-click silhouette presets are available in the shape panel. `elliptic` uses a 32-vertex superellipse, varying from a rounded rectangle (power 8) toward an ellipse (power 2) as intensity rises. `sculpted` uses elliptical floors with a sinusoidal size profile: the lower and upper floors shrink by the intensity fraction, while the middle reaches the permitted envelope. These curves are polygonal approximations; areas use those actual polygons, not ideal analytic ellipses.

`twisted` requests up to 90 degrees of accumulated floor rotation (`massShapePct * 3`). Each chamfered floor rotates around its local centre and scales to remain within its previously checked rectangle. A convex hull with a fixed central 55%-width/depth rectangle retains space for the vertical atrium; common cores are still separately fitted and validated across every storey. This creates discrete rotating storeys, **not** a continuous helical façade or a rigid rotation of the whole building. Fit constraints may reduce the apparent twist. Floor angles follow requested storey indices; height/FAR/core constraints may truncate the visible sequence.

For overlapping projections, only the union input is snapped to a one-micrometre grid to avoid trigonometric near-coincidences in polygon clipping. Actual per-storey contours and their areas stay unchanged. A containment fast path uses the largest enclosing floor when available. The four example sites, all A/B/C options and three intensities are covered by an additional 108-case calculation sweep during release QA.

For all three profiles, the continuous core remains in the shared inscribed region; rooms, corridors and perimeter support areas follow each actual storey polygon. Full matching room floors and exterior/atrium window segments are visible in plan and 3D. Curved façades are instanced in repeated panel groups to limit draw calls. PV rows that protrude beyond the real roof or cross an atrium are omitted. Upper projection unions, hotel counts, cached plans, workspace inputs and IFC contours all consume the same geometry. Rotating floors and changing overhangs require external structural design and incremental cost assessment; the standard conceptual cost model does not price complex transfer structures or bespoke curved panels.

## Manifold boundary

Pinned `manifold-3d@3.5.4`, source commit `ce50d78021d64507f89e8c9fc2c2e51018117857`, Apache-2.0. Official npm distribution SHA512 integrity is verified before vendoring; exact hashes are recorded in `vendor/manifold/provenance.json`. No external runtime download or image/LLM API is used.

The module worker receives geometry only. The adapter maps X/Z to Manifold X/-Y and height to Z, extrudes each contour, and optionally clips a rooftop crown by a plane. All WASM objects are explicitly deleted. Results are typed position/index arrays; the Three.js adapter replaces display buffers. Work is debounced, bounded to one active plus the latest pending job, cached by geometry, and protected against stale scene results. Until a job completes, or if WASM fails, the canonical contour extrusion remains visible. Finance and sensitivity calculations never await or execute WASM. The actual WebGL buffer can therefore be rebuilt without changing quantities.

## Roof scope

A sloped crown is a **nonoccupiable conceptual roof screen**, not extra floor space. The whole crown plus roof slab is reserved in the study height. It excludes rooftop PV. Its structural design, wind loads, statutory height interpretation and incremental construction costs require separate review. IFC currently exports the matching floor and roof slabs and core reservations; the crown, detailed façade and interiors are outside that conceptual IFC export scope. Do not describe this as a permit-ready or structurally verified BIM model.

## Compatibility and security

Missing settings default to legacy geometry and a flat roof; project version 1 remains importable. API validation, workspace save/import, hotel cache keys and UI requests include geometry inputs. The exterior/material tab remains the initial tab. Model-only public access and contact-only workbench routing are unchanged; private API authentication and disabled production review storage remain in force.

Only the exact vendored WASM path is statically allowed. CSP permits WebAssembly compilation through `wasm-unsafe-eval`, not JavaScript `unsafe-eval`; module workers are same-origin. The release allowlist contains the runtime, adapter, worker and license, excluding package metadata from the hosted web package.

## Future work

Arbitrary user-drawn curves/voids/booleans, continuous helical façades, free-form polygon subdivision beyond the generated convex storeys and structural/MEP design are not enabled in this version. Add them only after extending the same floor/area/core/plan/export contracts. Manifold subdivision count is not a storey count.

## Polygon interior contract

`interior-geometry.js` uses the already vendored polygon-clipping library. The orthogonal room/corridor partition is intersected with each generated storey contour, retaining real polygon area and optional atrium holes. A coverage ledger compares their union plus fixed cores, explicit obstacles and open support areas against the clear floor region. Unassigned area must remain below 0.01 m² in regression tests; this is an area accounting check, not an occupancy or permit certification. Tiny or inaccessible fragments become support reservations rather than fabricated guest rooms or dwelling units.

Furniture and rectangular wet-room modules must fit inside each actual room. Room polygons extend to the façade; a safe fitted rectangle only guides furniture placement. Hotel fitting prefers a 3.5 m clear module side (4 m for suites) where feasible, using the existing conceptual module assumptions, not invented statutory minima. Actual completed modules feed hotel finance quantities. The fixed vertical core does not rotate with individual floors.

SVG and WebGL share those polygon room surfaces, door positions, walls and actual exterior/atrium glazing segments. Walking and navigation reject points outside the true floor, including bounding-box corners and courtyard holes; navigation cache keys include the region. BIM coordination JSON retains closed variable-vertex loops, holes, actual areas, wall relations and per-storey support/coverage metadata in `[x, -z, height]` metres. Existing IFC export still excludes interior objects. Curves remain polygonal approximations; detailed structural, fire, accessibility and MEP design require separate work.
