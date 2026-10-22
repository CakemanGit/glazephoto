/**
 * GlazePhoto — общая обвязка инструментов-«мазков» (кисть и ластик).
 * Файл: frontend/src/tools/StrokeTool.ts
 *
 * Отвечает за: проверку, что слой можно рисовать, пересчёт clientX/Y в координаты
 * слоя с учётом Zoom/Pan, использование coalesced-точек и запись в историю.
 */

import { clientToDocument, documentToLayer } from "../core/Geometry";
import { isRasterLayer } from "../core/types";
import type { EditorConfig, Point, RasterLayer, ToolId } from "../core/types";
import { StrokeEngine } from "./Strokeengine";
import type { StrokeMode, StrokeParams } from "./Strokeengine";
import type { Tool, ToolContext, ToolPointerEvent, ToolPointerSample } from "./Tool";

export abstract class StrokeTool implements Tool {
  abstract readonly id: ToolId;

  protected readonly context: ToolContext;
  private readonly engine: StrokeEngine;
  private readonly historyLabel: string;
  private activePointerId: number | null = null;
  private activeLayer: RasterLayer | null = null;

  protected constructor(context: ToolContext, mode: StrokeMode, historyLabel: string) {
    this.context = context;
    this.engine = new StrokeEngine(mode);
    this.historyLabel = historyLabel;
  }

  /** Параметры мазка из текущей конфигурации редактора. */
  protected abstract resolveParams(config: EditorConfig): StrokeParams;

  onPointerDown(event: ToolPointerEvent): void {
    if (event.button !== 0 || this.activePointerId !== null) return;

    const layer = this.context.getActiveLayer();
    if (layer === null || !isRasterLayer(layer) || layer.locked || !layer.visible) return;

    const config = this.context.getEditorConfig();
    const start = this.toLayerPoint(event, config, layer);
    const started = this.engine.begin(
      layer,
      this.context.getSelection(),
      this.resolveParams(config),
      start,
    );
    if (!started) return;

    this.activePointerId = event.pointerId;
    this.activeLayer = layer;
    this.context.requestRender();
  }

  onPointerMove(event: ToolPointerEvent): void {
    const layer = this.activeLayer;
    if (layer === null || this.activePointerId !== event.pointerId) return;

    const config = this.context.getEditorConfig();
    const samples: readonly ToolPointerSample[] =
      event.coalesced.length > 0 ? event.coalesced : [event];
    const points: Point[] = samples.map((sample) => this.toLayerPoint(sample, config, layer));

    this.engine.extend(points);
    this.context.requestRender();
  }

  onPointerUp(event: ToolPointerEvent): void {
    const layer = this.activeLayer;
    if (layer === null || this.activePointerId !== event.pointerId) return;

    const config = this.context.getEditorConfig();
    this.engine.extend([this.toLayerPoint(event, config, layer)]);

    const entry = this.engine.end(this.historyLabel);
    this.activePointerId = null;
    this.activeLayer = null;

    if (entry !== null) this.context.pushHistory(entry);
    this.context.requestRender();
  }

  onPointerCancel(): void {
    if (this.activeLayer === null) return;
    this.engine.cancel();
    this.activePointerId = null;
    this.activeLayer = null;
    this.context.requestRender();
  }

  dispose(): void {
    this.onPointerCancel();
  }

  /**
   * clientX/clientY → координаты canvas слоя:
   * (client − положение контейнера − pan) / scale − offset слоя.
   */
  private toLayerPoint(
    sample: ToolPointerSample,
    config: EditorConfig,
    layer: RasterLayer,
  ): Point {
    const documentPoint = clientToDocument(
      sample.clientX,
      sample.clientY,
      this.context.getViewportRect(),
      config,
    );
    return documentToLayer(documentPoint, layer);
  }
}