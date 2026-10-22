import { isRasterLayer, type Layer, type RasterLayer } from "./types";

interface HistoryEntry {
  layerId: string;
  data: ImageData;
}

/** Stores bounded pixel snapshots for undo and redo operations. */
export class HistoryManager {
  private static readonly maxHistoryDepth = 30;

  private readonly undoStack: HistoryEntry[] = [];
  private readonly redoStack: HistoryEntry[] = [];

  /** Saves a copy of a layer's pixels before a change and clears redo history. */
  saveState(layerId: string, data: ImageData): void {
    this.pushBounded(this.undoStack, {
      layerId,
      data: new ImageData(data.data.slice(), data.width, data.height),
    });
    this.redoStack.length = 0;
  }

  /** Restores the previous snapshot for its layer, if one is available. */
  undo(layers: Layer[]): void {
    const previousState = this.undoStack[this.undoStack.length - 1];
    if (!previousState) {
      return;
    }

    const layer = this.findLayer(layers, previousState.layerId);
    const context = this.getContext(layer);
    this.validateSnapshotSize(layer, previousState.data);
    const currentState = this.captureCurrentState(layer, context);

    context.putImageData(previousState.data, 0, 0);
    this.undoStack.pop();
    this.pushBounded(this.redoStack, currentState);
  }

  /** Reapplies the most recently undone snapshot, if one is available. */
  redo(layers: Layer[]): void {
    const nextState = this.redoStack[this.redoStack.length - 1];
    if (!nextState) {
      return;
    }

    const layer = this.findLayer(layers, nextState.layerId);
    const context = this.getContext(layer);
    this.validateSnapshotSize(layer, nextState.data);
    const currentState = this.captureCurrentState(layer, context);

    context.putImageData(nextState.data, 0, 0);
    this.redoStack.pop();
    this.pushBounded(this.undoStack, currentState);
  }

  private findLayer(layers: Layer[], layerId: string): RasterLayer {
    const layer = layers.find((candidate) => candidate.id === layerId);
    if (!layer) {
      throw new Error(`History refers to a layer that no longer exists: ${layerId}`);
    }

    if (!isRasterLayer(layer)) {
      throw new Error(`History pixel snapshots can only be applied to raster layers: ${layerId}`);
    }
    return layer;
  }

  private getContext(layer: RasterLayer): CanvasRenderingContext2D {
    const context = layer.canvasElement.getContext("2d");
    if (!context) {
      throw new Error(`Could not get a 2D context for layer: ${layer.id}`);
    }

    return context;
  }

  private captureCurrentState(
    layer: RasterLayer,
    context: CanvasRenderingContext2D,
  ): HistoryEntry {
    return {
      layerId: layer.id,
      data: context.getImageData(
        0,
        0,
        layer.canvasElement.width,
        layer.canvasElement.height,
      ),
    };
  }

  private validateSnapshotSize(layer: RasterLayer, data: ImageData): void {
    if (
      data.width !== layer.canvasElement.width ||
      data.height !== layer.canvasElement.height
    ) {
      throw new Error(
        `History snapshot dimensions do not match layer ${layer.id}.`,
      );
    }
  }

  private pushBounded(stack: HistoryEntry[], entry: HistoryEntry): void {
    stack.push(entry);
    if (stack.length > HistoryManager.maxHistoryDepth) {
      stack.shift();
    }
  }
}