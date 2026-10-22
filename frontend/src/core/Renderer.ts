import type {
  CompositeFailure,
  CompositeLayerMessage,
  CompositeRequest,
  CompositeSuccess,
} from "./OffscreenWorker";
import { isRasterLayer, type Layer } from "./types";

type CompositeResponse = CompositeSuccess | CompositeFailure;

type RenderWaiter = {
  resolve: () => void;
  reject: (error: Error) => void;
};

interface QueuedRender {
  canvas: HTMLCanvasElement;
  /** Retained by reference and read only when the worker becomes available. */
  layers: readonly Layer[];
  waiters: RenderWaiter[];
}

interface ActiveRender {
  requestId: number;
  job: QueuedRender;
}

const MAX_DOCUMENT_PIXELS = 40_000_000;
const MAX_TRANSFERRED_LAYER_PIXELS = 60_000_000;

/**
 * Single-flight, latest-frame renderer.
 *
 * Only one frame is sent to the worker at a time. While it is busy, requests for
 * the same output canvas are coalesced into one queued job; only the latest layer
 * state is captured and transferred when that job is dispatched. This prevents
 * pointer-move events from creating an unbounded queue of stale 4K pixel buffers.
 */
export class Renderer {
  private readonly worker: Worker;
  private nextRequestId = 0;
  private activeRender: ActiveRender | null = null;
  private readonly queue: QueuedRender[] = [];
  private readonly queuedByCanvas = new WeakMap<HTMLCanvasElement, QueuedRender>();
  private disposed = false;
  private workerError: Error | null = null;

  constructor() {
    this.worker = new Worker(new URL("./OffscreenWorker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.addEventListener("message", this.handleMessage);
    this.worker.addEventListener("error", this.handleWorkerError);
    this.worker.addEventListener("messageerror", this.handleMessageError);
  }

  /**
   * Enqueues a composite request. Repeated requests for one canvas are merged,
   * and their promises settle after the newest queued state has been processed.
   */
  render(mainCanvas: HTMLCanvasElement, layers: readonly Layer[]): Promise<void> {
    if (this.disposed) {
      return Promise.reject(new Error("Renderer has been disposed."));
    }
    if (this.workerError) {
      return Promise.reject(this.workerError);
    }
    if (mainCanvas.width <= 0 || mainCanvas.height <= 0) {
      return Promise.reject(new RangeError("The output canvas must have positive dimensions."));
    }
    if (mainCanvas.width * mainCanvas.height > MAX_DOCUMENT_PIXELS) {
      return Promise.reject(new RangeError("The output canvas exceeds the supported pixel limit."));
    }
    if (!mainCanvas.getContext("2d")) {
      return Promise.reject(
        new Error("Could not get a 2D rendering context for the main canvas."),
      );
    }

    return new Promise<void>((resolve, reject) => {
      const waiter: RenderWaiter = { resolve, reject };
      const queued = this.queuedByCanvas.get(mainCanvas);
      if (queued) {
        queued.layers = layers;
        queued.waiters.push(waiter);
      } else {
        const job: QueuedRender = { canvas: mainCanvas, layers, waiters: [waiter] };
        this.queue.push(job);
        this.queuedByCanvas.set(mainCanvas, job);
      }
      this.dispatchNext();
    });
  }

  /** Terminates the worker and rejects all unfinished render operations. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.removeEventListener("message", this.handleMessage);
    this.worker.removeEventListener("error", this.handleWorkerError);
    this.worker.removeEventListener("messageerror", this.handleMessageError);
    this.worker.terminate();

    const error = new Error("Renderer has been disposed.");
    if (this.activeRender) this.rejectJob(this.activeRender.job, error);
    this.activeRender = null;
    for (const job of this.queue) this.rejectJob(job, error);
    this.queue.length = 0;
  }

  private dispatchNext(): void {
    if (this.disposed || this.workerError || this.activeRender !== null) return;

    const job = this.queue.shift();
    if (!job) return;
    if (this.queuedByCanvas.get(job.canvas) === job) {
      this.queuedByCanvas.delete(job.canvas);
    }

    try {
      const context = job.canvas.getContext("2d");
      if (!context) throw new Error("Could not get a 2D rendering context for the main canvas.");

      const visibleLayers: CompositeLayerMessage[] = [];
      const transferables: ArrayBuffer[] = [];
      let totalLayerPixels = 0;

      for (const layer of job.layers) {
        if (!layer.visible) continue;
        if (!Number.isFinite(layer.opacity) || layer.opacity < 0 || layer.opacity > 1) {
          throw new RangeError(`Layer ${layer.id} opacity must be between 0 and 1.`);
        }
        if (layer.opacity === 0) continue;
        if (!isRasterLayer(layer)) {
          throw new Error(
            `The current compositor accepts raster layers only; layer "${layer.name}" has type "${layer.type}".`,
          );
        }

        const layerCanvas = layer.canvasElement;
        if (layerCanvas.width <= 0 || layerCanvas.height <= 0) continue;
        const layerPixelCount = layerCanvas.width * layerCanvas.height;
        if (!Number.isSafeInteger(layerPixelCount)) {
          throw new RangeError(`Layer ${layer.id} has invalid dimensions.`);
        }
        totalLayerPixels += layerPixelCount;
        if (totalLayerPixels > MAX_TRANSFERRED_LAYER_PIXELS) {
          throw new RangeError(
            `Visible layers exceed the ${MAX_TRANSFERRED_LAYER_PIXELS.toLocaleString()}-pixel transfer budget for one frame.`,
          );
        }
        const layerContext = layerCanvas.getContext("2d", { willReadFrequently: true });
        if (!layerContext) {
          throw new Error(`Could not get a 2D context for layer: ${layer.id}`);
        }

        if (!Number.isFinite(layer.offsetX) || !Number.isFinite(layer.offsetY)) {
          throw new RangeError(`Layer ${layer.id} has invalid position coordinates.`);
        }

        const imageData = layerContext.getImageData(0, 0, layerCanvas.width, layerCanvas.height);
        const pixels = imageData.data;
        if (!(pixels.buffer instanceof ArrayBuffer) || pixels.byteLength !== layerCanvas.width * layerCanvas.height * 4) {
          throw new Error(`Layer ${layer.id} pixel buffer is not transferable.`);
        }

        visibleLayers.push({
          width: imageData.width,
          height: imageData.height,
          pixels,
          opacity: layer.opacity,
          blendMode: layer.blendMode,
          offsetX: layer.offsetX,
          offsetY: layer.offsetY,
        });
        transferables.push(pixels.buffer);
      }

      const requestId = this.getNextRequestId();
      const request: CompositeRequest = {
        type: "composite",
        requestId,
        layers: visibleLayers,
        width: job.canvas.width,
        height: job.canvas.height,
      };
      this.activeRender = { requestId, job };
      this.worker.postMessage(request, transferables);
    } catch (caught) {
      if (this.activeRender?.job === job) this.activeRender = null;
      const error = caught instanceof Error ? caught : new Error("Failed to prepare a composite frame.");
      this.rejectOrForward(job, error);
      this.dispatchNext();
    }
  }

  private readonly handleMessage = (event: MessageEvent<CompositeResponse>): void => {
    const response = event.data;
    const active = this.activeRender;
    if (!active || !response || response.requestId !== active.requestId) return;
    this.activeRender = null;

    const queuedReplacement = this.queuedByCanvas.get(active.job.canvas);
    if (queuedReplacement) {
      // Do not flash a stale frame. Its callers are completed by the newer frame.
      queuedReplacement.waiters.unshift(...active.job.waiters);
      active.job.waiters.length = 0;
      if (response.type === "composite-error") {
        // The latest request may have corrected the invalid state; retry that job.
      }
      this.dispatchNext();
      return;
    }

    if (response.type === "composite-error") {
      this.rejectJob(active.job, new Error(response.message));
      this.dispatchNext();
      return;
    }

    try {
      if (
        response.width !== active.job.canvas.width ||
        response.height !== active.job.canvas.height ||
        response.pixels.length !== response.width * response.height * 4
      ) {
        throw new Error("The worker returned a frame with invalid dimensions or pixel data.");
      }
      const context = active.job.canvas.getContext("2d");
      if (!context) throw new Error("Could not get a 2D rendering context for the main canvas.");

      const imageData = new ImageData(response.pixels, response.width, response.height);
      context.save();
      try {
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, active.job.canvas.width, active.job.canvas.height);
        context.putImageData(imageData, 0, 0);
      } finally {
        context.restore();
      }
      this.resolveJob(active.job);
    } catch (caught) {
      this.rejectJob(
        active.job,
        caught instanceof Error ? caught : new Error("Failed to display the worker frame."),
      );
    }

    this.dispatchNext();
  };

  private readonly handleWorkerError = (event: ErrorEvent): void => {
    event.preventDefault();
    this.failWorker(new Error(event.message || "The rendering worker encountered an error."));
  };

  private readonly handleMessageError = (): void => {
    this.failWorker(new Error("Could not deserialize a message from the rendering worker."));
  };

  private failWorker(error: Error): void {
    if (this.workerError || this.disposed) return;
    this.workerError = error;
    this.worker.terminate();

    if (this.activeRender) this.rejectJob(this.activeRender.job, error);
    this.activeRender = null;
    for (const job of this.queue) this.rejectJob(job, error);
    this.queue.length = 0;
  }

  private rejectOrForward(job: QueuedRender, error: Error): void {
    const replacement = this.queuedByCanvas.get(job.canvas);
    if (replacement) replacement.waiters.unshift(...job.waiters);
    else this.rejectJob(job, error);
  }

  private resolveJob(job: QueuedRender): void {
    for (const waiter of job.waiters) waiter.resolve();
    job.waiters.length = 0;
  }

  private rejectJob(job: QueuedRender, error: Error): void {
    for (const waiter of job.waiters) waiter.reject(error);
    job.waiters.length = 0;
  }

  private getNextRequestId(): number {
    this.nextRequestId = this.nextRequestId >= Number.MAX_SAFE_INTEGER ? 1 : this.nextRequestId + 1;
    return this.nextRequestId;
  }
}
