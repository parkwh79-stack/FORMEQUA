# UI refinement — 2026-11-02

The atelier keeps its photographic layout and automatic entrance motion. The model viewer keeps the exterior/material tab as its initial tab. Public model access, contact-only workbench routing, private API protection and disabled production review storage are unchanged.

The public atelier also skips the hidden workbench's automatic parcel status, live-law and site-context requests, including local HTTP preview. It still loads the public reviewed-law manifest. This prevents invisible tools from causing unnecessary loading or authentication prompts; internal workbench queries and server authentication remain unchanged.

## Explanations and actual states

`ui-feedback.js/css` supply local-only, text-safe explanations for density, height, conceptual floors and financial assumptions. Help is available on hover, keyboard focus and click/tap, supports Escape, preserves existing descriptive IDs, stays inside the viewport and does not activate its parent KPI navigation. Mobile help is dismissible. DSCR help follows the implemented **NOI / total PF annual interest** formula; it does not label that estimate as a periodic principal-and-interest coverage ratio. Efficiency and bespoke-structure costs remain explicitly scoped as assumptions.

Material selection and sculptural presets acknowledge successful input application. Download notifications say that the download has started; they do not claim a completed filesystem write. Long-running Manifold work emits pending/ready/fallback/idle states from the actual current revision. Older results cannot clear the latest pending indicator. Worker failure settles the latest queued model in contour-fallback mode. Empty models cancel pending UI state. First-view placeholders disappear when the actual scene is rebuilt or the existing viewer-unavailable fallback takes over. No fabricated percentage or artificial loading delay is used.

## Panels and advanced controls

The model editor is a nonmodal panel with explicit collapse/reopen controls. Closing it releases viewport width and preserves its active tab, selected material and geometry inputs. Focus returns to the opener when closed from inside the panel; Escape in the editor closes the editor before another model-level action. Interior and plan controls retain their existing behavior.

The primary silhouette presets, height and contour strength remain directly available. A/B/C placement and roof/crown controls sit under the native `details` disclosure. Its summary identifies the selected placement. Closing the disclosure has no calculation effect. Help buttons remain separate from input labels so the label continues to activate the correct input.

## Studies

The featured image/copy split and the remaining photo collection keep their current images, orientation ratios and project links. Image actions move below photos. Featured copy occupies its own grid column. Card focus and selection are visible; selected examples expose `aria-pressed`.

On section entry, the district name, image curtain, title and supporting information play in a short staggered sequence. Lazy photographs reserve their space with a quiet placeholder; the image/copy sequence waits for actual image readiness, with an error path that still reveals the content. Animation continues without additional wheel movement and runs once per card. Keyboard focus requests a card entrance immediately. The existing hero, manifesto, other section entrances and in-page navigation remain intact. Reduced-motion mode displays content without these animated entrances. No scroll locking, scroll snapping, autoplay carousel or extra image-generation service is introduced.

## Validation

The unit regression covers async worker status ordering, stale success suppression, latest queued failure and empty-model settlement. Browser QA covers desktop and mobile help, keyboard dismissal, editor collapse/reopen, advanced disclosures, material/preset feedback, actual pending/ready/fallback state, SVG/video downloads, photograph/text separation, autonomous card entrances, reduced motion and existing public navigation/security boundaries.
