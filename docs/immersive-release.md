# Immersive rooms and faster arrivals

This change improves the default library before adding expensive visual effects. Every room still opens with its architecture, furnishings, shelf labels, and complete collection. Auto remains the default; Cinematic is an explicit preference.

## Loading and rendering

- Keep one renderer across room changes and prepare the assembled room's shaders before the first complete frame.
- Remove the extra timed reveal after readiness. Measure stages and actual renderer submissions so later work can distinguish loading from frame cost.
- Share tuned model materials, retain a bounded source-model cache, and stop continuous rendering while reading or when the page is hidden.
- Keep refraction, shadow maps, HDR environments, and post-processing in Cinematic. Transparent glass and water remain visible in lighter modes without a second full-scene transmission pass.
- Generate boot preloads and runtime URLs from one asset-revision manifest.

## Room changes

| Room | Changes |
| --- | --- |
| Modern Archive | Offset arrival reveals the daylight installation and garden; softer stone response, furniture contact shading, and framed entrance panels. |
| Heritage Oak | Arrival looks past the reading chairs toward the fireplace; warmer practical light, softer leather and wood response, paneled doors, and a compact animated flame silhouette. |
| Gothic Nocturne | Arrival reveals the nave and rose window; readable cool stone light, a restrained window-light pool, and an iron entrance grille flanked by two unobstructed nightscape panels. |
| Renaissance Scriptorium | A marble-framed opening onto a modeled stone terrace, low balustrade and cypress garden, with distant hills and a continuous sky. Three selected wall bays hold bronze and carved-stone studies; shelf routes remain open. The exterior reuses the existing photograph and marble maps, with instanced planting and no additional lights or animation. |
| Art Deco Athenaeum | Stronger brass and emerald definition, softer seat/floor response, furniture contact, and a geometric brass entrance grille. |
| Neon Foundry | Twin copper relay chambers flank the industrial shutter, with recessed rotors, inspection meters, and slowly travelling cyan/magenta signals. Satin wall panels and floor conduits tie the machinery into the room without additional texture downloads or shadow lights. |
| Lunar South Pole Archive | Offset arrival retains the Earth view, improves task-light balance, softens the deck, and gives the entrance pressure-door detailing. |
| Arkship Memory Gallery | Continuous observation sky with softly fading nebulae; a passenger almanac shares journey, habitat and community information, with a static overview when motion is paused. |
| The Alexandrian Mouseion | Warmer harbor light and softer limestone, contact below the exhibit, and portrait framing centered on the mechanism. Preserve the existing archive grille and sourced exhibit. |

The contact and window-light masks are small procedural textures. This pass adds no downloaded model, sound, or material asset. Existing shelf anchors, aisle clearances, and collision bounds remain in place.

## Reading and exploration

- A one-book collection offers direct **Read**, **Find on shelf**, and import actions.
- Mobile contents opens above the article without shrinking it. Closing the drawer restores the full reading view, and heading jumps close it on narrow screens.
- Reader, room notes, and display settings contain keyboard focus and restore it on exit. Search shortcuts stay inside the reader while a book is open.
- Search snippets are cropped around their actual match.
- Settings expose quality, volume, room-motion pause, return to entrance, and short room notes. Procedural spatial ambience is optional and pauses while reading or when the page is hidden.
- Quiet exploration has a visible way back. Atlas room names remain visible without hovering.

## Verification and limits

Use the commands and visual protocol in [scene development](scene-development.md) and [performance](performance.md). Current Atlas previews use the default Auto view at normal brightness; mobile baselines are 390 by 844 pixels with the neutral starter guide.

Local browser timings are diagnostic evidence, not a guarantee for another device or host. Cinematic still requires substantially more rendering work and data. A release should also receive a real-phone touch/landscape pass and cold/warm measurements on its intended host.

This pass uses procedural contact shading rather than baked architectural lightmaps. Larger exterior reconstructions, extensive new landmark mechanics, and additional decorative clutter are separate art changes that need their own performance evidence.

## Publication rehearsal

Rehearse publication from a fresh Git LFS clone with no generated collection files. Confirm that the neutral starter guide is the only bundled book, build and enforce the byte budgets, inspect the resulting images, and review the exact refs and LFS objects intended for publication. An ignored file can still exist in older history; a clean current checkout alone does not establish a clean release history.

The software dependency lock includes the patched `fflate` resolution used by `three-stdlib`. Static catalogue and browser import providers remain in the reusable application; collection-specific service adapters belong in downstream editions.
