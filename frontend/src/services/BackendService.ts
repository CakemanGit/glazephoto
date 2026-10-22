import { HistoryManager } from "../core/HistoryManager";
import { LayerManager } from "../core/LayerManager";
import { isRasterLayer, type Layer } from "../core/types";

export class BackendService {
  private static readonly processImageUrl =
    "http://localhost:5097/api/ImageProcessing/ProcessImage";
  private static readonly requestTimeoutMs = 120_000;

  static async sendImageToFilter(
    imageBlob: Blob,
    filterType: string,
  ): Promise<Blob> {
    if (imageBlob.size === 0) {
      throw new Error("Cannot send an empty image to the image-processing service.");
    }

    if (!filterType.trim()) {
      throw new Error("A filter type must be provided.");
    }

    const formData = new FormData();
    formData.append("image", imageBlob, "image.png");
    formData.append("filterType", filterType);

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      BackendService.requestTimeoutMs,
    );

    try {
      const response = await fetch(BackendService.processImageUrl, {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });

      if (!response.ok) {
        const responseMessage = await response.text();
        const detail = responseMessage.trim();
        throw new Error(
          `Image processing failed (${response.status} ${response.statusText})${
            detail ? `: ${detail}` : "."
          }`,
        );
      }

      return await response.blob();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown network error.";
      const isTimeout =
        error instanceof DOMException && error.name === "AbortError";

      console.error(
        isTimeout
          ? "Image processing request timed out."
          : "Image processing request failed:",
        message,
      );

      if (error instanceof Error) {
        throw error;
      }

      throw new Error(message);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Sends the active layer to the backend and replaces its pixels with the
   * processed image. The original pixels are saved for undo after success.
   */
  static async applyFilterToActiveLayer(
    layerManager: LayerManager,
    historyManager: HistoryManager,
    filterType: string,
  ): Promise<void> {
    if (!filterType.trim()) {
      throw new Error("A filter type must be provided.");
    }

    const activeLayerId = layerManager.getActiveLayerId();
    const layer = layerManager
      .getLayers()
      .find((candidate) => candidate.id === activeLayerId);

    if (!layer) {
      throw new Error("Select a layer before applying a filter.");
    }
    if (!isRasterLayer(layer)) {
      throw new Error("The selected filter can only process raster layers.");
    }

    const layerContext = BackendService.getLayerContext(layer);
    const submittedImageData = layerContext.getImageData(
      0,
      0,
      layer.canvasElement.width,
      layer.canvasElement.height,
    );
    const requestCanvas = document.createElement("canvas");
    requestCanvas.width = submittedImageData.width;
    requestCanvas.height = submittedImageData.height;

    try {
      const requestContext = requestCanvas.getContext("2d");
      if (!requestContext) {
        throw new Error("Could not create a canvas for the filter request.");
      }

      requestContext.putImageData(submittedImageData, 0, 0);
      const requestBlob = await BackendService.canvasToBlob(requestCanvas);
      const responseBlob = await BackendService.sendImageToFilter(
        requestBlob,
        filterType,
      );
      const processedBitmap = await createImageBitmap(responseBlob);

      try {
        if (
          processedBitmap.width !== layer.canvasElement.width ||
          processedBitmap.height !== layer.canvasElement.height
        ) {
          throw new Error("The processed image dimensions do not match the layer.");
        }

        const currentLayer = layerManager
          .getLayers()
          .find((candidate) => candidate.id === layer.id);
        if (!currentLayer) {
          throw new Error("The target layer was removed while its filter was processing.");
        }
        if (!isRasterLayer(currentLayer)) {
          throw new Error("The target layer changed to a non-raster type while processing.");
        }

        const currentContext = BackendService.getLayerContext(currentLayer);
        const previousState = currentContext.getImageData(
          0,
          0,
          currentLayer.canvasElement.width,
          currentLayer.canvasElement.height,
        );

        const resultCanvas = document.createElement("canvas");
        resultCanvas.width = processedBitmap.width;
        resultCanvas.height = processedBitmap.height;
        try {
          const resultContext = resultCanvas.getContext("2d");
          if (!resultContext) {
            throw new Error("Could not create a canvas for the processed image.");
          }

          resultContext.drawImage(processedBitmap, 0, 0);
          const processedState = resultContext.getImageData(
            0,
            0,
            processedBitmap.width,
            processedBitmap.height,
          );

          historyManager.saveState(currentLayer.id, previousState);
          currentContext.putImageData(processedState, 0, 0);
        } finally {
          resultCanvas.width = 0;
          resultCanvas.height = 0;
        }
      } finally {
        processedBitmap.close();
      }
    } catch (error) {
      console.error(`Could not apply filter "${filterType}" to the active layer:`, error);
      throw error;
    } finally {
      requestCanvas.width = 0;
      requestCanvas.height = 0;
    }
  }

  private static getLayerContext(layer: Layer): CanvasRenderingContext2D {
    if (!isRasterLayer(layer)) {
      throw new Error(`Layer "${layer.name}" is not a raster layer.`);
    }
    const context = layer.canvasElement.getContext("2d");
    if (!context) {
      throw new Error(`Could not get a 2D context for layer "${layer.name}".`);
    }

    return context;
  }

  private static canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("Could not encode the active layer as a PNG image."));
          return;
        }

        resolve(blob);
      }, "image/png");
    });
  }
}
