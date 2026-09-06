# Performance optimization cycle

The application ships an interactive shell before it starts the expensive 3D path. The runtime sequence is:

1. render the branded shell and mark `library:shell-ready`;
2. fetch the slim catalogue and mark `library:catalog-ready`;
3. lazy-load the scene bundle and the compact authored room model;
4. build the model, shelves, required furnishing materials, labels, room details, exterior, lighting, and effects concurrently;
5. assemble the compact room and prepare its materials with `compileAsync`, allowing parallel shader compilation where the browser supports it;
6. open navigation on the first complete frame, without an additional timed reveal;
7. on explicitly selected cinematic sessions, request the complete model after the room has been interactive for a sustained interval and fade it in without blocking navigation.

Every quality tier opens with authored architecture, room details, and the complete collection. Lite, balanced, auto, and data-saving sessions retain the compact model to avoid a second transfer and decode pause. An explicitly selected cinematic session upgrades to the complete model after interaction is established. Adaptive quality also controls pixel ratio, shadows, effects, lighting cost, and atlas resolution.

Default sessions use the authored practical, ambient, hemisphere, and directional lighting rig, plus small procedural contact and window-light masks. Shadow-map passes, HDR reflections, refraction, and post-processing belong to explicit cinematic sessions. Lite and balanced use transparent glass and water without the additional full-scene transmission pass. Cinematic includes its HDR environment in the pre-interaction readiness gate; its larger architecture model remains deferred.

Compact startup models keep 512px source resolution but use native WebP texture decoding to minimize both transfer and time-to-first-room. Complete models retain 1024px GPU-compressed KTX2 textures for steady-state visual quality and memory efficiency.

Alexandria and the two space rooms render their Cinematic lighting and detailed models directly, without the screen-space effect chain. The full-model walkthrough produced saturated frames with that chain in the two space rooms; direct rendering follows Alexandria's existing policy. Procedural contact shading remains available in these rooms.

The loading screen reports real aggregate progress for code, architecture, collection, and lighting stages. The document's `data-room-profile` records stage timings, resource totals, and observed main-thread long tasks for the current transition. It contains no book text or request URLs. These figures overlap and must not be added together as independent costs. Long-task entries arrive asynchronously, so this snapshot can omit work still executing in the presentation frame; use a browser performance trace for a complete CPU breakdown.

The canvas exposes measured draw submissions across all passes, triangles, geometry/texture/program counts, frame-time p95, FPS, quality, model tier, renderer identity, and atlas telemetry. Steady-state sampling begins after presentation and excludes the first resumed frame. Profile only a visible, unoccluded test session and record the browser, GPU, viewport, cache state, and quality; background scheduling is not a production performance benchmark.

Large books are fetched concurrently with metadata, tokenized in a worker, sanitized section by section, and rendered through section virtualization. Reader requests are abortable and successful content uses a two-book/20 MiB LRU.

Book spine labels are packed into one worker-generated `OffscreenCanvas` atlas and rendered with one instanced mesh. A single renderer survives room transitions. Model clones share tuned materials within each room, while source models use a bounded two-room cache with delayed eviction. Shelf and furnishing materials load only the families required by the active room. Procedural ambience starts only when requested, follows the camera, and stops while reading or when the tab is hidden.

## Enforced budgets

After a production build, run `pnpm perf:budget`. It rejects:

- a catalogue above 1 MB raw or 200 KB gzip;
- the complete catalogue-usable shell graph above 190 KB gzip;
- the scene bootstrap graph above 450 KB gzip;
- the reader bootstrap graph above 220 KB gzip;
- initial styles above 45 KB gzip;
- a fallback world model above 2 MiB;
- a complete world model above 12 MiB;
- a complete room bundle above 16 MiB;
- any Blender `.raw.glb` source model copied into `dist`.

## Repeatable review

For each material change:

1. run type-checks and tests;
2. build the static library and enforce the budgets;
3. deploy to a development environment when appropriate;
4. record cold and warm shell/catalogue/complete-room timings, catalogue transfer size, scene telemetry, large-reader open time, and a representative in-book find;
5. compare medians from at least three runs and investigate regressions over 10%.

Record project-specific measurements in release notes rather than committing private infrastructure details here. Reader virtualization, progressive search, worker-generated labels, and bounded room caching are active.
