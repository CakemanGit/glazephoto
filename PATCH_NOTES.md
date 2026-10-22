# GlazePhoto source patch

## Main updated files

- `frontend/src/core/Renderer.ts` — single-flight renderer; per-canvas latest-frame coalescing; transferable pixel buffers; stale-frame suppression; worker failure/disposal handling; validation and memory guard.
- `frontend/src/core/OffscreenWorker.ts` — validated worker protocol; transferable output buffer; latest-pending-frame mailbox; bounded pixel batches; layer compositing and blend functions.
- `frontend/src/components/EditorUI.tsx` — explicitly typed React state; real raster layers; connected brush/eraser/move tools; client-to-document coordinate mapping; zoom/pan; layer controls; pixel-patch undo/redo; import; synchronized PNG export; functional raster-layer auto-enhance, exposure and contrast operations.

## Supporting integration changes

- `frontend/src/core/LayerManager.ts`
- `frontend/src/core/HistoryManager.ts`
- `frontend/src/services/BackendService.ts`
- `frontend/src/tools/Stroketool.ts`
- `frontend/src/tools/Strokeengine.ts`
- `frontend/src/tools/MoveTool.ts`
- `frontend/src/tools/ZoomPanManager.ts`
- `frontend/src/index.css`

The original backend source is included unchanged.

## Validation performed

- Strict TypeScript check of all frontend `.ts`/`.tsx` sources with `--strict --noUnusedLocals --noUnusedParameters`, using temporary ambient declarations for React and Lucide because the uploaded archive lacks its npm manifest and TypeScript configuration.
- Syntax transpile check of all three requested files.
- Worker-level runtime checks for source-over alpha compositing, Multiply blend mode, and invalid-opacity rejection.

## Scope and remaining limits

The uploaded archive did not contain `package.json`, `tsconfig.json`, `vite.config.*`, browser test setup, or installed project dependencies, so an official Vite production build and browser E2E run could not be performed. The compositor currently processes raster layers only; a visible non-raster layer returns a clear error rather than being silently misrendered. Undo/redo records pixel patches (brush, eraser and the raster adjustments); structural layer operations and layer-property changes are not yet full undoable commands. The editor does not yet implement all advanced layer types, adjustment-layer rendering, masks and layer effects from `types.ts`. This patch is an integration baseline, not a claim of complete Photoshop parity or a legal opinion guaranteeing freedom from patent, copyright, or trade-dress claims. The editor keeps its existing Aero visual language and does not intentionally reproduce Photoshop's interface.
