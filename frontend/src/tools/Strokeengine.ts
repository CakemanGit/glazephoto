/**
 * GlazePhoto — движок мазка (общий для кисти и ластика).
 * Файл: frontend/src/tools/StrokeEngine.ts
 *
 * Как это работает:
 *  1. На pointerdown снимается копия слоя (baseCanvas) и создаётся буфер мазка (strokeCanvas).
 *  2. Движение указателя разбивается на штампы с постоянным шагом (линейная
 *     интерполяция с переносом остатка) — линия непрерывна при любой скорости мыши.
 *  3. Штампы копятся в strokeCanvas с учётом Flow. Затем обновлённая область слоя
 *     пересобирается: слой = baseCanvas + strokeCanvas × Opacity (кисть)
 *     или baseCanvas − strokeCanvas × Opacity (ластик). Opacity ограничивает мазок
 *     целиком, поэтому самопересечения не «темнеют».
 *  4. Выделение (прямоугольник, контур, bitmap волшебной палочки) ограничивает
 *     мазок через маску на уровне альфа-канала.
 *  5. На pointerup формируется запись истории: дифф «до/после» только для затронутой области.
 *
 * Память: на время мазка живут 2 canvas размером со слой (+1 для выделения,
 * +1 при активном выделении). После мазка всё освобождается.
 */

import {
  circleBounds,
  clamp,
  interpolateStamps,
  intersectRect,
  isEmptyRect,
  unionRect,
  vectorPathToPath2D,
} from "../core/Geometry";
import type { PixelPatchEntry, Point, RasterLayer, Rect, RgbaColor, SelectionState } from "../core/types";

/** paint — нанесение цвета, erase — стирание до прозрачности. */
export type StrokeMode = "paint" | "erase";

/** Параметры мазка. Для erase поле color игнорируется. */
export interface StrokeParams {
  /** Диаметр, px документа. */
  size: number;
  /** Жёсткость края, 0..1. */
  hardness: number;
  /** Непрозрачность всего мазка, 0..1. */
  opacity: number;
  /** Интенсивность одного штампа, 0..1. */
  flow: number;
  /** Шаг между штампами в долях диаметра. */
  spacing: number;
  color: RgbaColor;
}

/** Максимальный диаметр кисти (защита от гигантских tip-canvas). */
const MAX_BRUSH_SIZE = 2000;

/** Кэш отпечатка кисти. */
interface BrushTip {
  key: string;
  canvas: HTMLCanvasElement;
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(width));
  canvas.height = Math.max(1, Math.floor(height));
  return canvas;
}

function releaseCanvas(canvas: HTMLCanvasElement | null): void {
  if (canvas === null) return;
  canvas.width = 0;
  canvas.height = 0;
}

function normalizeParams(params: StrokeParams): StrokeParams {
  return {
    size: clamp(Number.isFinite(params.size) ? params.size : 1, 1, MAX_BRUSH_SIZE),
    hardness: clamp(Number.isFinite(params.hardness) ? params.hardness : 1, 0, 1),
    opacity: clamp(Number.isFinite(params.opacity) ? params.opacity : 1, 0, 1),
    flow: clamp(Number.isFinite(params.flow) ? params.flow : 1, 0.01, 1),
    spacing: clamp(Number.isFinite(params.spacing) ? params.spacing : 0.1, 0.01, 1),
    color: {
      r: Math.round(clamp(params.color.r, 0, 255)),
      g: Math.round(clamp(params.color.g, 0, 255)),
      b: Math.round(clamp(params.color.b, 0, 255)),
      a: clamp(params.color.a, 0, 1),
    },
  };
}

/**
 * Строит маску выделения размером с canvas слоя: альфа 255 там, где рисовать можно.
 * Возвращает null, если выделения нет (рисовать можно везде).
 */
function buildSelectionMask(
  selection: SelectionState,
  layer: RasterLayer,
  width: number,
  height: number,
): HTMLCanvasElement | null {
  if (selection.kind === "none") return null;

  const mask = createCanvas(width, height);
  const maskCtx = mask.getContext("2d");
  if (maskCtx === null) return mask;

  if (selection.kind === "rect") {
    maskCtx.fillStyle = "#000";
    maskCtx.fillRect(
      selection.rect.x - layer.offsetX,
      selection.rect.y - layer.offsetY,
      selection.rect.width,
      selection.rect.height,
    );
    return mask;
  }

  if (selection.kind === "path") {
    if (selection.feather > 0) {
      maskCtx.filter = `blur(${selection.feather}px)`;
    }
    maskCtx.fillStyle = "#000";
    maskCtx.fill(vectorPathToPath2D(selection.path, layer.offsetX, layer.offsetY));
    return mask;
  }

  // bitmap (результат Волшебной палочки)
  const { bounds, alpha } = selection;
  if (bounds.width <= 0 || bounds.height <= 0 || alpha.length < bounds.width * bounds.height) {
    return mask; // повреждённое выделение — рисовать нельзя нигде
  }
  const image = maskCtx.createImageData(bounds.width, bounds.height);
  const pixelCount = bounds.width * bounds.height;
  for (let i = 0; i < pixelCount; i += 1) {
    image.data[i * 4 + 3] = alpha[i] ?? 0;
  }
  const piece = createCanvas(bounds.width, bounds.height);
  const pieceCtx = piece.getContext("2d");
  if (pieceCtx !== null) {
    pieceCtx.putImageData(image, 0, 0);
    maskCtx.drawImage(piece, bounds.x - layer.offsetX, bounds.y - layer.offsetY);
  }
  releaseCanvas(piece);
  return mask;
}

export class StrokeEngine {
  private readonly mode: StrokeMode;

  private layer: RasterLayer | null = null;
  private layerCtx: CanvasRenderingContext2D | null = null;
  private baseCanvas: HTMLCanvasElement | null = null;
  private baseCtx: CanvasRenderingContext2D | null = null;
  private strokeCanvas: HTMLCanvasElement | null = null;
  private strokeCtx: CanvasRenderingContext2D | null = null;
  private scratchCanvas: HTMLCanvasElement | null = null;
  private scratchCtx: CanvasRenderingContext2D | null = null;
  private selectionMask: HTMLCanvasElement | null = null;

  private params: StrokeParams | null = null;
  private tip: BrushTip | null = null;
  private lastPoint: Point | null = null;
  private carry = 0;
  private dirty: Rect | null = null;

  constructor(mode: StrokeMode) {
    this.mode = mode;
  }

  /** true, пока мазок начат и не завершён. */
  get active(): boolean {
    return this.layer !== null;
  }

  /**
   * Начать мазок. start — в координатах canvas слоя.
   * Возвращает false, если мазок начать нельзя (нет контекста 2D, пустой canvas).
   */
  begin(
    layer: RasterLayer,
    selection: SelectionState,
    params: StrokeParams,
    start: Point,
  ): boolean {
    if (this.active) this.cancel();

    const canvas = layer.canvasElement;
    const width = canvas.width;
    const height = canvas.height;
    if (width <= 0 || height <= 0) return false;

    const layerCtx = canvas.getContext("2d");
    if (layerCtx === null) return false;

    const baseCanvas = createCanvas(width, height);
    const baseCtx = baseCanvas.getContext("2d");
    const strokeCanvas = createCanvas(width, height);
    const strokeCtx = strokeCanvas.getContext("2d");
    if (baseCtx === null || strokeCtx === null) {
      releaseCanvas(baseCanvas);
      releaseCanvas(strokeCanvas);
      return false;
    }
    baseCtx.drawImage(canvas, 0, 0);

    this.layer = layer;
    this.layerCtx = layerCtx;
    this.baseCanvas = baseCanvas;
    this.baseCtx = baseCtx;
    this.strokeCanvas = strokeCanvas;
    this.strokeCtx = strokeCtx;
    this.selectionMask = buildSelectionMask(selection, layer, width, height);
    if (this.selectionMask !== null) {
      this.scratchCanvas = createCanvas(width, height);
      this.scratchCtx = this.scratchCanvas.getContext("2d");
    }
    this.params = normalizeParams(params);
    this.tip = this.ensureTip(this.params);
    this.lastPoint = start;
    this.carry = 0;
    this.dirty = null;

    this.drawStamps([start]);
    return true;
  }

  /**
   * Продолжить мазок точками движения (в координатах canvas слоя, по порядку).
   * Между точками автоматически добавляются штампы с постоянным шагом.
   */
  extend(points: readonly Point[]): void {
    if (this.layer === null || this.lastPoint === null || this.params === null) return;

    const step = Math.max(1, this.params.size * this.params.spacing);
    const stamps: Point[] = [];
    let from = this.lastPoint;
    for (const to of points) {
      const result = interpolateStamps(from, to, step, this.carry);
      this.carry = result.carry;
      for (const stamp of result.points) stamps.push(stamp);
      from = to;
    }
    this.lastPoint = from;

    if (stamps.length > 0) this.drawStamps(stamps);
  }

  /**
   * Завершить мазок. Возвращает запись истории с диффом изменённой области
   * или null, если пиксели не менялись.
   */
  end(label: string): PixelPatchEntry | null {
    const layer = this.layer;
    const layerCtx = this.layerCtx;
    const baseCtx = this.baseCtx;
    if (layer === null || layerCtx === null || baseCtx === null) {
      this.release();
      return null;
    }

    let entry: PixelPatchEntry | null = null;
    if (this.dirty !== null) {
      const canvasBounds: Rect = {
        x: 0,
        y: 0,
        width: layer.canvasElement.width,
        height: layer.canvasElement.height,
      };
      const rect = intersectRect(this.dirty, canvasBounds);
      if (!isEmptyRect(rect)) {
        const before = baseCtx.getImageData(rect.x, rect.y, rect.width, rect.height);
        const after = layerCtx.getImageData(rect.x, rect.y, rect.width, rect.height);
        const beforeBuffer = before.data.buffer as ArrayBuffer;
        const afterBuffer = after.data.buffer as ArrayBuffer;
        entry = {
          id: createEntryId(),
          type: "pixel-patch",
          label,
          timestamp: Date.now(),
          byteSize: beforeBuffer.byteLength + afterBuffer.byteLength,
          layerId: layer.id,
          rect,
          before: beforeBuffer,
          after: afterBuffer,
        };
      }
    }

    this.release();
    return entry;
  }

  /** Отменить мазок: слой возвращается в состояние до pointerdown. */
  cancel(): void {
    const layer = this.layer;
    const layerCtx = this.layerCtx;
    const base = this.baseCanvas;
    if (layer !== null && layerCtx !== null && base !== null) {
      layerCtx.save();
      layerCtx.globalAlpha = 1;
      layerCtx.globalCompositeOperation = "source-over";
      layerCtx.clearRect(0, 0, layer.canvasElement.width, layer.canvasElement.height);
      layerCtx.drawImage(base, 0, 0);
      layerCtx.restore();
    }
    this.release();
  }

  /** Освобождает все временные canvas. */
  private release(): void {
    releaseCanvas(this.baseCanvas);
    releaseCanvas(this.strokeCanvas);
    releaseCanvas(this.scratchCanvas);
    releaseCanvas(this.selectionMask);
    this.layer = null;
    this.layerCtx = null;
    this.baseCanvas = null;
    this.baseCtx = null;
    this.strokeCanvas = null;
    this.strokeCtx = null;
    this.scratchCanvas = null;
    this.scratchCtx = null;
    this.selectionMask = null;
    this.params = null;
    this.lastPoint = null;
    this.carry = 0;
    this.dirty = null;
  }

  /** Создаёт (или берёт из кэша) отпечаток кисти с заданной жёсткостью. */
  private ensureTip(params: StrokeParams): BrushTip {
    const rgb =
      this.mode === "erase" ? "0,0,0" : `${params.color.r},${params.color.g},${params.color.b}`;
    const key = `${this.mode}|${params.size}|${params.hardness}|${rgb}`;
    if (this.tip !== null && this.tip.key === key) return this.tip;

    releaseCanvas(this.tip === null ? null : this.tip.canvas);

    const radius = params.size / 2;
    const outer = radius + 0.5; // полпикселя на сглаживание края
    const dimension = Math.ceil(outer * 2) + 1;
    const canvas = createCanvas(dimension, dimension);
    const ctx = canvas.getContext("2d");
    if (ctx !== null) {
      const center = dimension / 2;
      const gradient = ctx.createRadialGradient(center, center, 0, center, center, outer);
      const hardStop = clamp((params.hardness * radius) / outer, 0, 1);
      gradient.addColorStop(0, `rgba(${rgb},1)`);
      gradient.addColorStop(hardStop, `rgba(${rgb},1)`);
      gradient.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, dimension, dimension);
    }
    const tip: BrushTip = { key, canvas };
    this.tip = tip;
    return tip;
  }

  /** Рисует штампы в буфер мазка и пересобирает затронутую область слоя. */
  private drawStamps(stamps: readonly Point[]): void {
    const strokeCtx = this.strokeCtx;
    const params = this.params;
    const tip = this.tip;
    if (strokeCtx === null || params === null || tip === null) return;

    const half = tip.canvas.width / 2;
    const alpha = params.flow * (this.mode === "paint" ? params.color.a : 1);

    strokeCtx.save();
    strokeCtx.globalCompositeOperation = "source-over";
    strokeCtx.globalAlpha = alpha;

    let region: Rect | null = null;
    for (const stamp of stamps) {
      strokeCtx.drawImage(tip.canvas, stamp.x - half, stamp.y - half);
      region = unionRect(region, circleBounds(stamp, half + 1));
    }
    strokeCtx.restore();

    if (region === null) return;
    this.dirty = unionRect(this.dirty, region);
    this.compositeRegion(region);
  }

  /** Слой[region] = база[region] + мазок[region] (кисть) либо база − мазок (ластик). */
  private compositeRegion(region: Rect): void {
    const layer = this.layer;
    const layerCtx = this.layerCtx;
    const baseCanvas = this.baseCanvas;
    const params = this.params;
    if (layer === null || layerCtx === null || baseCanvas === null || params === null) return;

    const area = intersectRect(region, {
      x: 0,
      y: 0,
      width: layer.canvasElement.width,
      height: layer.canvasElement.height,
    });
    if (isEmptyRect(area)) return;

    const source = this.maskedStrokeSource(area);
    if (source === null) return;

    layerCtx.save();
    layerCtx.globalCompositeOperation = "source-over";
    layerCtx.globalAlpha = 1;
    layerCtx.clearRect(area.x, area.y, area.width, area.height);
    layerCtx.drawImage(
      baseCanvas,
      area.x,
      area.y,
      area.width,
      area.height,
      area.x,
      area.y,
      area.width,
      area.height,
    );
    layerCtx.globalAlpha = params.opacity;
    layerCtx.globalCompositeOperation = this.mode === "paint" ? "source-over" : "destination-out";
    layerCtx.drawImage(
      source,
      area.x,
      area.y,
      area.width,
      area.height,
      area.x,
      area.y,
      area.width,
      area.height,
    );
    layerCtx.restore();
  }

  /**
   * Возвращает canvas, из которого берётся мазок для области: буфер мазка
   * либо (при активном выделении) его копия, обрезанная маской выделения.
   */
  private maskedStrokeSource(area: Rect): HTMLCanvasElement | null {
    const strokeCanvas = this.strokeCanvas;
    if (strokeCanvas === null) return null;
    if (this.selectionMask === null) return strokeCanvas;

    const scratch = this.scratchCanvas;
    const scratchCtx = this.scratchCtx;
    if (scratch === null || scratchCtx === null) return null;

    scratchCtx.save();
    scratchCtx.beginPath();
    scratchCtx.rect(area.x, area.y, area.width, area.height);
    scratchCtx.clip();
    scratchCtx.globalAlpha = 1;
    scratchCtx.globalCompositeOperation = "source-over";
    scratchCtx.clearRect(area.x, area.y, area.width, area.height);
    scratchCtx.drawImage(
      strokeCanvas,
      area.x,
      area.y,
      area.width,
      area.height,
      area.x,
      area.y,
      area.width,
      area.height,
    );
    scratchCtx.globalCompositeOperation = "destination-in";
    scratchCtx.drawImage(
      this.selectionMask,
      area.x,
      area.y,
      area.width,
      area.height,
      area.x,
      area.y,
      area.width,
      area.height,
    );
    scratchCtx.restore();
    return scratch;
  }
}

/** Уникальный идентификатор записи истории. */
function createEntryId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `h-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}