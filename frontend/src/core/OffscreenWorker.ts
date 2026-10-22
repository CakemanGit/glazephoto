import { BlendMode } from "./types";

/** Pixel data passed across the worker boundary as a transferable buffer. */
export interface CompositeLayerMessage {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  opacity: number;
  blendMode: BlendMode;
  offsetX: number;
  offsetY: number;
}

export interface CompositeRequest {
  type: "composite";
  requestId: number;
  layers: CompositeLayerMessage[];
  width: number;
  height: number;
}

export interface CompositeSuccess {
  type: "composite-result";
  requestId: number;
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
}

export interface CompositeFailure {
  type: "composite-error";
  requestId: number;
  message: string;
}

type CompositeResponse = CompositeSuccess | CompositeFailure;
type WorkerMessageHandler = (event: MessageEvent<unknown>) => void;

interface WorkerScope {
  onmessage: WorkerMessageHandler | null;
  postMessage(message: CompositeResponse, transfer?: Transferable[]): void;
}

const workerScope = self as unknown as WorkerScope;
const supportedBlendModes = new Set<string>(Object.values(BlendMode));
const MAX_DOCUMENT_PIXELS = 40_000_000;
const MAX_LAYERS = 1_000;
const MAX_TRANSFERRED_LAYER_PIXELS = 60_000_000;
const PIXELS_PER_YIELD = 262_144;

let processing = false;
let pendingRequest: CompositeRequest | null = null;

/**
 * Worker-side mailbox. Only the active frame and the newest queued frame are
 * retained, so even accidental direct callers cannot build an unbounded backlog.
 * The compositor yields between row batches, allowing new messages to enter the
 * mailbox while a high-resolution frame is being processed.
 */
workerScope.onmessage = (event: MessageEvent<unknown>): void => {
  const candidate = event.data as Partial<CompositeRequest> | null;
  const requestId = Number.isSafeInteger(candidate?.requestId) ? candidate!.requestId! : -1;
  if (!isCompositeRequest(candidate)) {
    postFailure(requestId, "Invalid composite request message.");
    return;
  }

  if (processing) {
    if (pendingRequest) {
      postFailure(pendingRequest.requestId, "Frame superseded by a newer queued frame.");
    }
    pendingRequest = candidate;
    return;
  }

  void drainRequests(candidate);
};

async function drainRequests(firstRequest: CompositeRequest): Promise<void> {
  processing = true;
  let request: CompositeRequest | null = firstRequest;
  try {
    while (request !== null) {
      try {
        const pixels = await compositeLayers(request);
        const response: CompositeSuccess = {
          type: "composite-result",
          requestId: request.requestId,
          width: request.width,
          height: request.height,
          pixels,
        };
        workerScope.postMessage(response, [pixels.buffer]);
      } catch (caught) {
        postFailure(
          request.requestId,
          caught instanceof Error ? caught.message : "Unknown compositing error.",
        );
      }
      request = pendingRequest;
      pendingRequest = null;
    }
  } finally {
    processing = false;
    // A message can enter the mailbox at the boundary between the loop and finally.
    if (pendingRequest !== null) {
      const next = pendingRequest;
      pendingRequest = null;
      void drainRequests(next);
    }
  }
}

function isCompositeRequest(value: unknown): value is CompositeRequest {
  if (typeof value !== "object" || value === null) return false;
  const request = value as Partial<CompositeRequest>;
  return (
    request.type === "composite" &&
    Number.isSafeInteger(request.requestId) &&
    Number.isInteger(request.width) &&
    Number.isInteger(request.height) &&
    (request.width ?? 0) > 0 &&
    (request.height ?? 0) > 0 &&
    Array.isArray(request.layers)
  );
}

function postFailure(requestId: number, message: string): void {
  const response: CompositeFailure = { type: "composite-error", requestId, message };
  workerScope.postMessage(response);
}

async function compositeLayers(request: CompositeRequest): Promise<Uint8ClampedArray> {
  if (
    request.type !== "composite" ||
    !Number.isSafeInteger(request.requestId) ||
    !Number.isInteger(request.width) ||
    !Number.isInteger(request.height) ||
    request.width <= 0 ||
    request.height <= 0
  ) {
    throw new TypeError("Invalid composite request dimensions or message type.");
  }

  const pixelCount = request.width * request.height;
  if (!Number.isSafeInteger(pixelCount) || pixelCount > MAX_DOCUMENT_PIXELS) {
    throw new RangeError("Composite image dimensions exceed the supported limit.");
  }

  if (request.layers.length > MAX_LAYERS) {
    throw new RangeError(`A composite request cannot contain more than ${MAX_LAYERS} layers.`);
  }
  let totalLayerPixels = 0;
  for (const layer of request.layers) {
    validateLayer(layer);
    totalLayerPixels += layer.width * layer.height;
    if (totalLayerPixels > MAX_TRANSFERRED_LAYER_PIXELS) {
      throw new RangeError(
        `Visible layers exceed the ${MAX_TRANSFERRED_LAYER_PIXELS.toLocaleString()}-pixel transfer budget for one frame.`,
      );
    }
  }

  const destination = new Uint8ClampedArray(pixelCount * 4);
  let pixelsSinceYield = 0;
  for (const layer of request.layers) {
    if (layer.opacity === 0) continue;

    const source = layer.pixels;
    const opacity = layer.opacity;
    const blend = createBlendFunction(layer.blendMode);
    const blended: [number, number, number] = [0, 0, 0];
    const offsetX = Math.round(layer.offsetX);
    const offsetY = Math.round(layer.offsetY);
    const sourceWidth = layer.width;
    const sourceHeight = layer.height;

    for (let sourceY = 0; sourceY < sourceHeight; sourceY += 1) {
      const destinationY = sourceY + offsetY;
      if (destinationY >= 0 && destinationY < request.height) {
        for (let sourceX = 0; sourceX < sourceWidth; sourceX += 1) {
          const destinationX = sourceX + offsetX;
          if (destinationX >= 0 && destinationX < request.width) {
            const sourceIndex = (sourceY * sourceWidth + sourceX) * 4;
            const destinationIndex = (destinationY * request.width + destinationX) * 4;
            const sourceAlpha = (source[sourceIndex + 3] / 255) * opacity;

            if (sourceAlpha > 0) {
              const backdropAlpha = destination[destinationIndex + 3] / 255;
              const outputAlpha = sourceAlpha + backdropAlpha * (1 - sourceAlpha);
              const backdropRed = destination[destinationIndex] / 255;
              const backdropGreen = destination[destinationIndex + 1] / 255;
              const backdropBlue = destination[destinationIndex + 2] / 255;
              const sourceRed = source[sourceIndex] / 255;
              const sourceGreen = source[sourceIndex + 1] / 255;
              const sourceBlue = source[sourceIndex + 2] / 255;

              blend(
                backdropRed,
                backdropGreen,
                backdropBlue,
                sourceRed,
                sourceGreen,
                sourceBlue,
                blended,
              );
              const overlapAlpha = backdropAlpha * sourceAlpha;
              destination[destinationIndex] = toByte(
                ((1 - sourceAlpha) * backdropAlpha * backdropRed +
                  (1 - backdropAlpha) * sourceAlpha * sourceRed +
                  overlapAlpha * blended[0]) /
                  outputAlpha *
                  255,
              );
              destination[destinationIndex + 1] = toByte(
                ((1 - sourceAlpha) * backdropAlpha * backdropGreen +
                  (1 - backdropAlpha) * sourceAlpha * sourceGreen +
                  overlapAlpha * blended[1]) /
                  outputAlpha *
                  255,
              );
              destination[destinationIndex + 2] = toByte(
                ((1 - sourceAlpha) * backdropAlpha * backdropBlue +
                  (1 - backdropAlpha) * sourceAlpha * sourceBlue +
                  overlapAlpha * blended[2]) /
                  outputAlpha *
                  255,
              );
              destination[destinationIndex + 3] = toByte(outputAlpha * 255);
            }
          }

          pixelsSinceYield += 1;
          if (pixelsSinceYield >= PIXELS_PER_YIELD) {
            pixelsSinceYield = 0;
            await yieldToWorkerQueue();
          }
        }
      } else {
        pixelsSinceYield += sourceWidth;
        if (pixelsSinceYield >= PIXELS_PER_YIELD) {
          pixelsSinceYield %= PIXELS_PER_YIELD;
          await yieldToWorkerQueue();
        }
      }
    }
  }

  return destination;
}

function validateLayer(layer: CompositeLayerMessage): void {
  if (
    typeof layer !== "object" ||
    layer === null ||
    !Number.isInteger(layer.width) ||
    !Number.isInteger(layer.height) ||
    layer.width <= 0 ||
    layer.height <= 0 ||
    !Number.isSafeInteger(layer.width * layer.height) ||
    layer.width * layer.height > MAX_DOCUMENT_PIXELS ||
    !(layer.pixels instanceof Uint8ClampedArray) ||
    layer.pixels.length !== layer.width * layer.height * 4 ||
    !Number.isFinite(layer.offsetX) ||
    !Number.isFinite(layer.offsetY)
  ) {
    throw new TypeError("Every layer must have valid dimensions, pixel data, and finite offsets.");
  }
  if (!Number.isFinite(layer.opacity) || layer.opacity < 0 || layer.opacity > 1) {
    throw new RangeError("Layer opacity must be a finite number between 0 and 1.");
  }
  if (!supportedBlendModes.has(layer.blendMode)) {
    throw new TypeError(`Unsupported blend mode: ${layer.blendMode}`);
  }
}

function yieldToWorkerQueue(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

type BlendFunction = (
  backdropRed: number,
  backdropGreen: number,
  backdropBlue: number,
  sourceRed: number,
  sourceGreen: number,
  sourceBlue: number,
  result: [number, number, number],
) => void;

function createBlendFunction(mode: BlendMode): BlendFunction {
  switch (mode) {
    case BlendMode.Normal:
      return (_br, _bg, _bb, sr, sg, sb, result) => {
        result[0] = sr;
        result[1] = sg;
        result[2] = sb;
      };
    case BlendMode.Multiply:
      return (br, bg, bb, sr, sg, sb, result) => {
        result[0] = br * sr;
        result[1] = bg * sg;
        result[2] = bb * sb;
      };
    case BlendMode.Screen:
      return (br, bg, bb, sr, sg, sb, result) => {
        result[0] = br + sr - br * sr;
        result[1] = bg + sg - bg * sg;
        result[2] = bb + sb - bb * sb;
      };
    case BlendMode.Overlay:
      return (br, bg, bb, sr, sg, sb, result) => {
        result[0] = overlay(br, sr);
        result[1] = overlay(bg, sg);
        result[2] = overlay(bb, sb);
      };
    case BlendMode.Darken:
      return (br, bg, bb, sr, sg, sb, result) => {
        result[0] = Math.min(br, sr);
        result[1] = Math.min(bg, sg);
        result[2] = Math.min(bb, sb);
      };
    case BlendMode.Lighten:
      return (br, bg, bb, sr, sg, sb, result) => {
        result[0] = Math.max(br, sr);
        result[1] = Math.max(bg, sg);
        result[2] = Math.max(bb, sb);
      };
    case BlendMode.ColorDodge:
      return (br, bg, bb, sr, sg, sb, result) => {
        result[0] = colorDodge(br, sr);
        result[1] = colorDodge(bg, sg);
        result[2] = colorDodge(bb, sb);
      };
    case BlendMode.ColorBurn:
      return (br, bg, bb, sr, sg, sb, result) => {
        result[0] = colorBurn(br, sr);
        result[1] = colorBurn(bg, sg);
        result[2] = colorBurn(bb, sb);
      };
    case BlendMode.HardLight:
      return (br, bg, bb, sr, sg, sb, result) => {
        result[0] = overlay(sr, br);
        result[1] = overlay(sg, bg);
        result[2] = overlay(sb, bb);
      };
    case BlendMode.SoftLight:
      return (br, bg, bb, sr, sg, sb, result) => {
        result[0] = softLight(br, sr);
        result[1] = softLight(bg, sg);
        result[2] = softLight(bb, sb);
      };
    case BlendMode.Difference:
      return (br, bg, bb, sr, sg, sb, result) => {
        result[0] = Math.abs(br - sr);
        result[1] = Math.abs(bg - sg);
        result[2] = Math.abs(bb - sb);
      };
    case BlendMode.Exclusion:
      return (br, bg, bb, sr, sg, sb, result) => {
        result[0] = br + sr - 2 * br * sr;
        result[1] = bg + sg - 2 * bg * sg;
        result[2] = bb + sb - 2 * bb * sb;
      };
    case BlendMode.Hue:
      return nonSeparableBlend("hue");
    case BlendMode.Saturation:
      return nonSeparableBlend("saturation");
    case BlendMode.Color:
      return nonSeparableBlend("color");
    case BlendMode.Luminosity:
      return nonSeparableBlend("luminosity");
    default:
      throw new TypeError(`Unsupported blend mode: ${mode}`);
  }
}

function overlay(backdrop: number, source: number): number {
  return backdrop <= 0.5
    ? 2 * backdrop * source
    : 1 - 2 * (1 - backdrop) * (1 - source);
}

function colorDodge(backdrop: number, source: number): number {
  return source >= 1 ? 1 : Math.min(1, backdrop / (1 - source));
}

function colorBurn(backdrop: number, source: number): number {
  return source <= 0 ? 0 : 1 - Math.min(1, (1 - backdrop) / source);
}

function softLight(backdrop: number, source: number): number {
  if (source <= 0.5) {
    return backdrop - (1 - 2 * source) * backdrop * (1 - backdrop);
  }
  const curve = backdrop <= 0.25
    ? ((16 * backdrop - 12) * backdrop + 4) * backdrop
    : Math.sqrt(backdrop);
  return backdrop + (2 * source - 1) * (curve - backdrop);
}

type NonSeparableMode = "hue" | "saturation" | "color" | "luminosity";

function nonSeparableBlend(mode: NonSeparableMode): BlendFunction {
  const backdrop: [number, number, number] = [0, 0, 0];
  const source: [number, number, number] = [0, 0, 0];
  const intermediate: [number, number, number] = [0, 0, 0];

  return (br, bg, bb, sr, sg, sb, result) => {
    backdrop[0] = br;
    backdrop[1] = bg;
    backdrop[2] = bb;
    source[0] = sr;
    source[1] = sg;
    source[2] = sb;

    switch (mode) {
      case "hue":
        setSat(source, saturation(backdrop), intermediate);
        setLum(intermediate, luminosity(backdrop), result);
        return;
      case "saturation":
        setSat(backdrop, saturation(source), intermediate);
        setLum(intermediate, luminosity(backdrop), result);
        return;
      case "color":
        setLum(source, luminosity(backdrop), result);
        return;
      case "luminosity":
        setLum(backdrop, luminosity(source), result);
        return;
    }
  };
}

function luminosity(color: readonly number[]): number {
  return 0.3 * color[0] + 0.59 * color[1] + 0.11 * color[2];
}

function saturation(color: readonly number[]): number {
  return Math.max(color[0], color[1], color[2]) - Math.min(color[0], color[1], color[2]);
}

function setLum(
  color: readonly number[],
  targetLuminosity: number,
  result: [number, number, number],
): void {
  const delta = targetLuminosity - luminosity(color);
  result[0] = color[0] + delta;
  result[1] = color[1] + delta;
  result[2] = color[2] + delta;
  clipColor(result);
}

function setSat(color: readonly number[], targetSaturation: number, result: [number, number, number]): void {
  const min = Math.min(color[0], color[1], color[2]);
  const max = Math.max(color[0], color[1], color[2]);
  result[0] = color[0];
  result[1] = color[1];
  result[2] = color[2];

  if (max > min) {
    for (let index = 0; index < 3; index += 1) {
      result[index] = ((result[index] - min) * targetSaturation) / (max - min);
    }
  } else {
    result[0] = 0;
    result[1] = 0;
    result[2] = 0;
  }
}

function clipColor(color: [number, number, number]): void {
  const luminosityValue = luminosity(color);
  const min = Math.min(color[0], color[1], color[2]);
  const max = Math.max(color[0], color[1], color[2]);

  if (min < 0) {
    const denominator = luminosityValue - min;
    for (let index = 0; index < 3; index += 1) {
      color[index] = denominator === 0
        ? luminosityValue
        : luminosityValue + ((color[index] - luminosityValue) * luminosityValue) / denominator;
    }
  }
  if (max > 1) {
    const denominator = max - luminosityValue;
    for (let index = 0; index < 3; index += 1) {
      color[index] = denominator === 0
        ? luminosityValue
        : luminosityValue + ((color[index] - luminosityValue) * (1 - luminosityValue)) / denominator;
    }
  }
  color[0] = clampUnit(color[0]);
  color[1] = clampUnit(color[1]);
  color[2] = clampUnit(color[2]);
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function toByte(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.max(0, Math.min(255, value)));
}
