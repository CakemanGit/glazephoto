import { LayerManager } from "../core/LayerManager";
import { Renderer } from "../core/Renderer";
import { isRasterLayer, type Layer } from "../core/types";
import { BaseTool } from "./BaseTool";

/** Moves the active layer on the editor canvas. */
export class MoveTool extends BaseTool {
  private lastClientX = 0;
  private lastClientY = 0;
  private activeLayer: Layer | null = null;

  constructor(
    private readonly layerManager: LayerManager,
    private readonly renderer: Renderer,
    private readonly mainCanvas: HTMLCanvasElement,
  ) {
    super();
  }

  onMouseDown(
    e: MouseEvent,
    _ctx: CanvasRenderingContext2D,
    scale: number,
  ): void {
    if (e.button !== 0 || this.isDrawing) {
      return;
    }

    this.validateScale(scale);
    const activeLayerId = this.layerManager.getActiveLayerId();
    this.activeLayer =
      this.layerManager
        .getLayers()
        .find((layer) => layer.id === activeLayerId) ?? null;

    if (
      !this.activeLayer ||
      (isRasterLayer(this.activeLayer) && this.activeLayer.locked)
    ) {
      this.activeLayer = null;
      return;
    }

    this.lastClientX = e.clientX;
    this.lastClientY = e.clientY;
    this.isDrawing = true;
  }

  onMouseMove(
    e: MouseEvent,
    _ctx: CanvasRenderingContext2D,
    scale: number,
  ): void {
    if (!this.isDrawing || !this.activeLayer) {
      return;
    }

    this.validateScale(scale);
    this.activeLayer.offsetX += (e.clientX - this.lastClientX) / scale;
    this.activeLayer.offsetY += (e.clientY - this.lastClientY) / scale;
    this.lastClientX = e.clientX;
    this.lastClientY = e.clientY;

    void this.renderer
      .render(this.mainCanvas, this.layerManager.getLayers())
      .catch((error: unknown) => {
        console.error("Could not render the moved layer:", error);
      });
  }

  onMouseUp(
    _e: MouseEvent,
    _ctx: CanvasRenderingContext2D,
    _scale: number,
  ): void {
    this.isDrawing = false;
    this.activeLayer = null;
  }

  private validateScale(scale: number): void {
    if (!Number.isFinite(scale) || scale <= 0) {
      throw new RangeError("Canvas scale must be a positive finite number.");
    }
  }
}