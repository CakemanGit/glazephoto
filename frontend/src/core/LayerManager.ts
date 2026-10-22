import {
  BlendMode,
  createDefaultLayerStyles,
  type Layer,
  type RasterLayer,
} from "./types";

/** Creates and manages the editor's drawable raster layers. */
export class LayerManager {
  private readonly layers: Layer[] = [];
  private activeLayerId: string | null = null;

  /** Returns a shallow copy in compositing order (bottom to top). */
  getLayers(): readonly Layer[] {
    return [...this.layers];
  }

  /** Returns the active layer ID, or null when there are no layers. */
  getActiveLayerId(): string | null {
    return this.activeLayerId;
  }

  /** Creates a blank raster canvas and makes it active when it is the first layer. */
  addLayer(name: string, width: number, height: number): RasterLayer {
    if (!Number.isInteger(width) || width <= 0) {
      throw new RangeError("Layer width must be a positive integer.");
    }
    if (!Number.isInteger(height) || height <= 0) {
      throw new RangeError("Layer height must be a positive integer.");
    }

    if (this.layers.length >= 1_000) {
      throw new RangeError("The document has reached the 1,000-layer safety limit.");
    }

    const canvasElement = document.createElement("canvas");
    canvasElement.width = width;
    canvasElement.height = height;

    const layer: RasterLayer = {
      type: "raster",
      id: createLayerId(),
      name: name.trim() || "Untitled layer",
      width,
      height,
      offsetX: 0,
      offsetY: 0,
      opacity: 1,
      visible: true,
      blendMode: BlendMode.Normal,
      locked: false,
      mask: null,
      styles: createDefaultLayerStyles(),
      canvasElement,
    };

    this.layers.push(layer);
    this.activeLayerId ??= layer.id;
    return layer;
  }

  /** Removes a layer and releases any raster canvas backing store. */
  removeLayer(id: string): void {
    const index = this.layers.findIndex((layer) => layer.id === id);
    if (index === -1) throw new Error(`Cannot remove unknown layer: ${id}`);

    const [removedLayer] = this.layers.splice(index, 1);
    if (!removedLayer) throw new Error(`Layer not found at index ${index}.`);
    if (removedLayer.type === "raster") {
      removedLayer.canvasElement.width = 0;
      removedLayer.canvasElement.height = 0;
    }

    if (this.activeLayerId === id) {
      this.activeLayerId = this.layers[index]?.id ?? this.layers[this.layers.length - 1]?.id ?? null;
    }
  }

  /** Sets the active layer, throwing if the ID is not managed by this instance. */
  setActiveLayer(id: string): void {
    if (!this.layers.some((layer) => layer.id === id)) {
      throw new Error(`Cannot activate unknown layer: ${id}`);
    }
    this.activeLayerId = id;
  }

  /** Moves a layer to a new position in compositing order. */
  reorderLayers(oldIndex: number, newIndex: number): void {
    if (!Number.isInteger(oldIndex) || oldIndex < 0 || oldIndex >= this.layers.length) {
      throw new RangeError("The source layer index is out of range.");
    }
    if (!Number.isInteger(newIndex) || newIndex < 0 || newIndex >= this.layers.length) {
      throw new RangeError("The destination layer index is out of range.");
    }

    const [layer] = this.layers.splice(oldIndex, 1);
    if (!layer) throw new Error(`Layer not found at index ${oldIndex}.`);
    this.layers.splice(newIndex, 0, layer);
  }
}

function createLayerId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `layer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
