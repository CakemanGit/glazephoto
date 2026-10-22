import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Aperture,
  Brush,
  Check,
  ChevronDown,
  Contrast,
  Download,
  Droplet,
  Eraser,
  Eye,
  EyeOff,
  Hand,
  History,
  Image,
  Layers,
  Minus,
  MoreHorizontal,
  Move,
  PanelRightClose,
  Plus,
  Redo2,
  Search,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Trash2,
  Undo2,
  Upload,
  ZoomIn,
  type LucideIcon,
} from "lucide-react";
import { LayerManager } from "../core/LayerManager";
import { Renderer } from "../core/Renderer";
import {
  BlendMode,
  DEFAULT_BRUSH_CONFIG,
  DEFAULT_EDITOR_CONFIG,
  DEFAULT_ERASER_CONFIG,
  DEFAULT_TOOL_SETTINGS,
  MAX_ZOOM,
  MIN_ZOOM,
  createEmptyHistory,
  isRasterLayer,
  type EditorConfig,
  type EntityId,
  type HistoryEntry,
  type HistoryState,
  type Layer,
  type PixelPatchEntry,
  type SelectionState,
  type ToolId as CoreToolId,
} from "../core/types";
import { BrushTool } from "../tools/BrushTool";
import { EraserTool } from "../tools/EraserTool";
import { MoveTool } from "../tools/MoveTool";
import { toToolPointerEvent, type Tool, type ToolContext } from "../tools/Tool";

type ActiveToolId = Extract<CoreToolId, "brush" | "eraser" | "move" | "hand" | "zoom">;

interface ToolOption {
  id: ActiveToolId;
  label: string;
  icon: LucideIcon;
}

const DOCUMENT_WIDTH = 1200;
const DOCUMENT_HEIGHT = 800;
const PREVIEW_COLORS = ["#91c8e9", "#8ba7d4", "#43899b", "#d99e75", "#a7c8bc"] as const;

const tools: ToolOption[] = [
  { id: "brush", label: "Brush", icon: Brush },
  { id: "eraser", label: "Eraser", icon: Eraser },
  { id: "move", label: "Move", icon: Move },
  { id: "hand", label: "Pan", icon: Hand },
  { id: "zoom", label: "Zoom", icon: ZoomIn },
];

function hexToRgba(hex: string): { r: number; g: number; b: number; a: number } {
  const normalized = hex.trim().replace(/^#/, "");
  const full = normalized.length === 3
    ? normalized.split("").map((digit) => `${digit}${digit}`).join("")
    : normalized;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return { r: 168, g: 216, b: 255, a: 1 };
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
    a: 1,
  };
}

function createInitialConfig(): EditorConfig {
  return {
    ...DEFAULT_EDITOR_CONFIG,
    scale: 0.67,
    panX: 20,
    panY: 20,
    activeToolId: "brush",
    tools: {
      ...DEFAULT_TOOL_SETTINGS,
      brush: { ...DEFAULT_BRUSH_CONFIG, size: 42, opacity: 0.78, color: hexToRgba("#a8d8ff") },
      eraser: { ...DEFAULT_ERASER_CONFIG, size: 42, opacity: 0.78 },
    },
  };
}

function applyViewTransform(board: HTMLDivElement | null, config: EditorConfig): void {
  if (!board) return;
  board.style.transformOrigin = "0 0";
  board.style.transform = `translate(${config.panX}px, ${config.panY}px) scale(${config.scale})`;
}

function getEntryByteSize(entry: HistoryEntry): number {
  return entry.byteSize;
}

function describeLayer(layer: Layer): string {
  const typeLabel = layer.type === "raster"
    ? (layer.locked ? "Background · Locked" : "Pixel layer")
    : layer.type === "smartObject"
      ? "Smart object"
      : layer.type === "adjustment"
        ? "Adjustment layer"
        : "Text layer";
  return `${typeLabel} · ${Math.round(layer.opacity * 100)}%`;
}

function drawArtwork(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const width = canvas.width;
  const height = canvas.height;

  const sky = ctx.createLinearGradient(0, 0, 0, height * 0.69);
  sky.addColorStop(0, "#92b8ce");
  sky.addColorStop(0.43, "#d3c6b0");
  sky.addColorStop(0.72, "#e7c1a3");
  sky.addColorStop(1, "#a6b4b1");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  const glow = ctx.createRadialGradient(width * 0.72, height * 0.29, 8, width * 0.72, height * 0.29, width * 0.38);
  glow.addColorStop(0, "rgba(255, 235, 197, .85)");
  glow.addColorStop(0.28, "rgba(255, 221, 183, .27)");
  glow.addColorStop(1, "rgba(255, 221, 183, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height * 0.75);

  ctx.fillStyle = "rgba(255, 232, 201, .92)";
  ctx.beginPath();
  ctx.arc(width * 0.72, height * 0.31, width * 0.055, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#778e9a";
  ctx.beginPath();
  ctx.moveTo(0, height * 0.64);
  ctx.lineTo(width * 0.17, height * 0.32);
  ctx.lineTo(width * 0.28, height * 0.48);
  ctx.lineTo(width * 0.43, height * 0.23);
  ctx.lineTo(width * 0.65, height * 0.62);
  ctx.lineTo(width * 0.79, height * 0.4);
  ctx.lineTo(width, height * 0.65);
  ctx.lineTo(width, height * 0.78);
  ctx.lineTo(0, height * 0.78);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "rgba(232, 220, 198, .78)";
  ctx.beginPath();
  ctx.moveTo(width * 0.12, height * 0.41);
  ctx.lineTo(width * 0.17, height * 0.32);
  ctx.lineTo(width * 0.22, height * 0.4);
  ctx.lineTo(width * 0.18, height * 0.38);
  ctx.lineTo(width * 0.16, height * 0.42);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(width * 0.35, height * 0.37);
  ctx.lineTo(width * 0.43, height * 0.23);
  ctx.lineTo(width * 0.51, height * 0.39);
  ctx.lineTo(width * 0.44, height * 0.34);
  ctx.lineTo(width * 0.4, height * 0.39);
  ctx.closePath();
  ctx.fill();

  const water = ctx.createLinearGradient(0, height * 0.61, 0, height);
  water.addColorStop(0, "#829e9d");
  water.addColorStop(0.44, "#597f83");
  water.addColorStop(1, "#263f4e");
  ctx.fillStyle = water;
  ctx.fillRect(0, height * 0.62, width, height * 0.38);

  ctx.save();
  ctx.globalAlpha = 0.42;
  for (let i = 0; i < 30; i++) {
    const y = height * (0.67 + i * 0.0105);
    const lineWidth = width * (0.08 + (i % 5) * 0.035);
    const x = width * 0.72 - lineWidth / 2 + Math.sin(i * 2.1) * width * 0.035;
    ctx.strokeStyle = i % 3 === 0 ? "#f0d0af" : "#bfd0c0";
    ctx.lineWidth = i % 4 === 0 ? 2.5 : 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + lineWidth, y);
    ctx.stroke();
  }
  ctx.restore();

  ctx.fillStyle = "#233b3e";
  ctx.beginPath();
  ctx.moveTo(0, height * 0.71);
  ctx.lineTo(width * 0.15, height * 0.59);
  ctx.lineTo(width * 0.27, height * 0.71);
  ctx.lineTo(width * 0.36, height * 0.67);
  ctx.lineTo(width * 0.48, height * 0.79);
  ctx.lineTo(width * 0.48, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#1c3037";
  ctx.beginPath();
  ctx.moveTo(width, height * 0.66);
  ctx.lineTo(width * 0.87, height * 0.59);
  ctx.lineTo(width * 0.77, height * 0.73);
  ctx.lineTo(width * 0.65, height * 0.68);
  ctx.lineTo(width * 0.57, height * 0.82);
  ctx.lineTo(width, height * 0.88);
  ctx.closePath();
  ctx.fill();

  const vignette = ctx.createRadialGradient(width * 0.5, height * 0.44, height * 0.18, width * 0.5, height * 0.48, width * 0.72);
  vignette.addColorStop(0, "rgba(8, 21, 35, 0)");
  vignette.addColorStop(1, "rgba(8, 21, 35, .3)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
}

export default function EditorUI() {
  const stageRef = useRef<HTMLElement>(null);
  const canvasBoardRef = useRef<HTMLDivElement>(null);
  const compositeCanvasRef = useRef<HTMLCanvasElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const layerManagerRef = useRef<LayerManager | null>(null);
  const strokeToolsRef = useRef<Partial<Record<"brush" | "eraser", Tool>>>({});
  const moveToolRef = useRef<MoveTool | null>(null);
  const selectionRef = useRef<SelectionState>({ kind: "none" });
  const configRef = useRef<EditorConfig>(createInitialConfig());
  const historyRef = useRef<HistoryState>(createEmptyHistory());
  const spacePressedRef = useRef(false);
  const panPointerRef = useRef<{ pointerId: number; lastX: number; lastY: number } | null>(null);
  const hasManualViewRef = useRef(false);

  const [activeTool, setActiveTool] = useState<ActiveToolId>("brush");
  /** Display order is top-to-bottom; LayerManager stores bottom-to-top. */
  const [layers, setLayers] = useState<Layer[]>([]);
  const [selectedLayer, setSelectedLayer] = useState<EntityId | null>(null);
  const [brushSize, setBrushSize] = useState(42);
  const [brushOpacity, setBrushOpacity] = useState(78);
  const [brushColor, setBrushColor] = useState("#a8d8ff");
  const [zoom, setZoom] = useState(67);
  const [historyLabels, setHistoryLabels] = useState<string[]>(["Imported photograph"]);
  const [activeHistory, setActiveHistory] = useState(0);
  const [historyState, setHistoryState] = useState<HistoryState>(() => createEmptyHistory());
  const [renderError, setRenderError] = useState<string | null>(null);

  const syncLayerList = useCallback((manager?: LayerManager) => {
    const source = manager ?? layerManagerRef.current;
    if (source) setLayers([...source.getLayers()].reverse());
  }, []);

  const updateEditorConfig = useCallback((update: (current: EditorConfig) => EditorConfig) => {
    const next = update(configRef.current);
    if (!Number.isFinite(next.scale) || next.scale < MIN_ZOOM || next.scale > MAX_ZOOM) {
      throw new RangeError("Editor zoom must be finite and within the supported range.");
    }
    if (!Number.isFinite(next.panX) || !Number.isFinite(next.panY)) {
      throw new RangeError("Canvas pan offsets must be finite.");
    }
    configRef.current = next;
    setZoom(Math.round(next.scale * 100));
    applyViewTransform(canvasBoardRef.current, next);
  }, []);

  const requestRender = useCallback(() => {
    const renderer = rendererRef.current;
    const manager = layerManagerRef.current;
    const canvas = compositeCanvasRef.current;
    if (!renderer || !manager || !canvas) return;

    void renderer.render(canvas, manager.getLayers()).then(() => {
      if (rendererRef.current === renderer) setRenderError(null);
    }).catch((caught: unknown) => {
      if (rendererRef.current !== renderer) return;
      const error = caught instanceof Error ? caught.message : "Unknown rendering error.";
      setRenderError(error);
      console.error("GlazePhoto render failed:", caught);
    });
  }, []);

  const recordAction = useCallback((action: string) => {
    setHistoryLabels((current) => [action, ...current].slice(0, 8));
    setActiveHistory(0);
  }, []);

  const pushStrokeHistory = useCallback((entry: HistoryEntry) => {
    if (entry.type !== "pixel-patch") {
      recordAction(entry.label);
      return;
    }

    const current = historyRef.current;
    const discardedRedoBytes = current.redoStack.reduce((sum, item) => sum + getEntryByteSize(item), 0);
    const nextUndo = [...current.undoStack, entry];
    let usedBytes = current.usedBytes - discardedRedoBytes + getEntryByteSize(entry);
    while (nextUndo.length > current.maxEntries || usedBytes > current.memoryLimitBytes) {
      const oldest = nextUndo.shift();
      if (!oldest) break;
      usedBytes -= getEntryByteSize(oldest);
    }
    const next: HistoryState = {
      ...current,
      undoStack: nextUndo,
      redoStack: [],
      usedBytes: Math.max(0, usedBytes),
    };
    historyRef.current = next;
    setHistoryState(next);
    recordAction(entry.label);
  }, [recordAction]);

  const selectedLayerModel = layers.find((layer) => layer.id === selectedLayer) ?? null;

  const zoomAt = useCallback((clientX: number, clientY: number, factor: number) => {
    const stage = stageRef.current;
    if (!stage || !Number.isFinite(factor) || factor <= 0) return;
    const bounds = stage.getBoundingClientRect();
    const originLeft = bounds.left + stage.clientLeft;
    const originTop = bounds.top + stage.clientTop;
    const localX = clientX - originLeft;
    const localY = clientY - originTop;
    const current = configRef.current;
    const nextScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current.scale * factor));
    const documentX = (localX - current.panX) / current.scale;
    const documentY = (localY - current.panY) / current.scale;
    hasManualViewRef.current = true;
    updateEditorConfig((config) => ({
      ...config,
      scale: nextScale,
      panX: localX - documentX * nextScale,
      panY: localY - documentY * nextScale,
    }));
  }, [updateEditorConfig]);

  const zoomBy = useCallback((percentagePoints: number) => {
    const stage = stageRef.current;
    if (!stage) return;
    const bounds = stage.getBoundingClientRect();
    const centerX = bounds.left + stage.clientLeft + stage.clientWidth / 2;
    const centerY = bounds.top + stage.clientTop + stage.clientHeight / 2;
    const currentScale = configRef.current.scale;
    const targetScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, currentScale + percentagePoints / 100));
    zoomAt(centerX, centerY, targetScale / currentScale);
  }, [zoomAt]);

  const selectTool = useCallback((id: ActiveToolId) => {
    strokeToolsRef.current.brush?.onPointerCancel();
    strokeToolsRef.current.eraser?.onPointerCancel();
    const context = compositeCanvasRef.current?.getContext("2d");
    if (context && moveToolRef.current) {
      moveToolRef.current.onMouseUp(new MouseEvent("mouseup"), context, configRef.current.scale);
    }
    panPointerRef.current = null;
    setActiveTool(id);
    updateEditorConfig((current) => ({ ...current, activeToolId: id }));
  }, [updateEditorConfig]);

  const selectLayer = useCallback((id: EntityId) => {
    const manager = layerManagerRef.current;
    if (!manager) return;
    try {
      manager.setActiveLayer(id);
      setSelectedLayer(id);
      syncLayerList(manager);
    } catch (caught) {
      console.error("Could not select layer:", caught);
    }
  }, [syncLayerList]);

  const addLayer = useCallback(() => {
    const manager = layerManagerRef.current;
    if (!manager) return;
    try {
      const layer = manager.addLayer(`Layer ${manager.getLayers().length + 1}`, DOCUMENT_WIDTH, DOCUMENT_HEIGHT);
      manager.setActiveLayer(layer.id);
      setSelectedLayer(layer.id);
      syncLayerList(manager);
      recordAction("New raster layer");
      requestRender();
    } catch (caught) {
      setRenderError(caught instanceof Error ? caught.message : "Could not create the layer.");
    }
  }, [recordAction, requestRender, syncLayerList]);

  const toggleVisibility = useCallback((id: EntityId) => {
    const manager = layerManagerRef.current;
    const layer = manager?.getLayers().find((candidate) => candidate.id === id);
    if (!manager || !layer) return;
    layer.visible = !layer.visible;
    syncLayerList(manager);
    recordAction(`${layer.visible ? "Show" : "Hide"} ${layer.name}`);
    requestRender();
  }, [recordAction, requestRender, syncLayerList]);

  const removeSelectedLayer = useCallback(() => {
    const manager = layerManagerRef.current;
    if (!manager || !selectedLayer) return;
    const managedLayers = manager.getLayers();
    if (managedLayers.length <= 1) return;
    try {
      manager.removeLayer(selectedLayer);
      const nextActiveId = manager.getActiveLayerId();
      setSelectedLayer(nextActiveId);
      syncLayerList(manager);
      recordAction("Layer removed");
      requestRender();
    } catch (caught) {
      setRenderError(caught instanceof Error ? caught.message : "Could not remove the layer.");
    }
  }, [recordAction, requestRender, selectedLayer, syncLayerList]);

  const changeLayerOpacity = useCallback((percentage: number) => {
    const manager = layerManagerRef.current;
    const layer = manager?.getLayers().find((candidate) => candidate.id === selectedLayer);
    if (!manager || !layer) return;
    layer.opacity = Math.max(0, Math.min(1, percentage / 100));
    syncLayerList(manager);
    requestRender();
  }, [requestRender, selectedLayer, syncLayerList]);

  const changeBlendMode = useCallback((mode: BlendMode) => {
    const manager = layerManagerRef.current;
    const layer = manager?.getLayers().find((candidate) => candidate.id === selectedLayer);
    if (!manager || !layer) return;
    layer.blendMode = mode;
    syncLayerList(manager);
    requestRender();
    recordAction(`Blend mode: ${mode}`);
  }, [recordAction, requestRender, selectedLayer, syncLayerList]);

  const updateBrushSize = useCallback((size: number) => {
    setBrushSize(size);
    updateEditorConfig((current) => ({
      ...current,
      tools: {
        ...current.tools,
        brush: { ...current.tools.brush, size },
        eraser: { ...current.tools.eraser, size },
      },
    }));
  }, [updateEditorConfig]);

  const updateBrushOpacity = useCallback((opacity: number) => {
    setBrushOpacity(opacity);
    updateEditorConfig((current) => ({
      ...current,
      tools: {
        ...current.tools,
        brush: { ...current.tools.brush, opacity: opacity / 100 },
        eraser: { ...current.tools.eraser, opacity: opacity / 100 },
      },
    }));
  }, [updateEditorConfig]);

  const updateBrushColor = useCallback((color: string) => {
    setBrushColor(color);
    updateEditorConfig((current) => ({
      ...current,
      tools: {
        ...current.tools,
        brush: { ...current.tools.brush, color: hexToRgba(color) },
      },
    }));
  }, [updateEditorConfig]);

  const applyPixelPatch = useCallback((entry: PixelPatchEntry, side: "before" | "after"): boolean => {
    const manager = layerManagerRef.current;
    const layer = manager?.getLayers().find((candidate) => candidate.id === entry.layerId);
    if (!layer || !isRasterLayer(layer)) {
      setRenderError("The layer referenced by this history entry no longer exists.");
      return false;
    }
    const context = layer.canvasElement.getContext("2d");
    if (!context) {
      setRenderError("Could not restore pixels because the layer canvas has no 2D context.");
      return false;
    }
    const buffer = entry[side].slice(0);
    const expectedBytes = entry.rect.width * entry.rect.height * 4;
    if (buffer.byteLength !== expectedBytes) {
      setRenderError("The history pixel patch has invalid dimensions.");
      return false;
    }
    const pixels = new Uint8ClampedArray(buffer);
    context.putImageData(new ImageData(pixels, entry.rect.width, entry.rect.height), entry.rect.x, entry.rect.y);
    return true;
  }, []);

  const applyLayerAdjustment = useCallback((mode: "auto" | "exposure" | "contrast") => {
    const manager = layerManagerRef.current;
    const layer = manager?.getLayers().find((candidate) => candidate.id === selectedLayer);
    if (!manager || !layer || !isRasterLayer(layer)) {
      setRenderError("Select a raster layer before applying an adjustment.");
      return;
    }
    if (layer.locked) {
      setRenderError("The selected layer is locked. Unlock it before applying an adjustment.");
      return;
    }

    const context = layer.canvasElement.getContext("2d", { willReadFrequently: true });
    if (!context) {
      setRenderError("Could not apply the adjustment because the layer canvas has no 2D context.");
      return;
    }

    try {
      const width = layer.canvasElement.width;
      const height = layer.canvasElement.height;
      const image = context.getImageData(0, 0, width, height);
      const beforePixels = image.data.slice();
      const afterPixels = image.data.slice();
      let minimum = 255;
      let maximum = 0;
      let hasVisiblePixels = false;

      for (let index = 0; index < beforePixels.length; index += 4) {
        if ((beforePixels[index + 3] ?? 0) === 0) continue;
        hasVisiblePixels = true;
        minimum = Math.min(minimum, beforePixels[index] ?? 0, beforePixels[index + 1] ?? 0, beforePixels[index + 2] ?? 0);
        maximum = Math.max(maximum, beforePixels[index] ?? 0, beforePixels[index + 1] ?? 0, beforePixels[index + 2] ?? 0);
      }

      if (!hasVisiblePixels) {
        setRenderError("The selected layer is empty. Paint or import pixels before adjusting it.");
        return;
      }
      if (mode === "auto" && minimum === maximum) {
        setRenderError("Auto enhance found no tonal range to stretch on this layer.");
        return;
      }

      const label = mode === "auto"
        ? "Auto enhance"
        : mode === "exposure"
          ? "Exposure +0.35 EV"
          : "Contrast +15%";
      const autoRange = maximum - minimum;
      const exposureFactor = 2 ** 0.35;
      let changed = false;

      for (let index = 0; index < beforePixels.length; index += 4) {
        if ((beforePixels[index + 3] ?? 0) === 0) continue;
        for (let channel = 0; channel < 3; channel += 1) {
          const original = beforePixels[index + channel] ?? 0;
          let adjusted: number;
          if (mode === "auto") {
            adjusted = Math.round(((original - minimum) / autoRange) * 255);
          } else if (mode === "exposure") {
            adjusted = Math.round(original * exposureFactor);
          } else {
            adjusted = Math.round((original - 127.5) * 1.15 + 127.5);
          }
          const clamped = Math.max(0, Math.min(255, adjusted));
          afterPixels[index + channel] = clamped;
          if (clamped !== original) changed = true;
        }
      }

      if (!changed) {
        setRenderError("The adjustment would not change any visible pixels on this layer.");
        return;
      }

      context.putImageData(new ImageData(afterPixels, width, height), 0, 0);
      const before = beforePixels.buffer as ArrayBuffer;
      const after = afterPixels.buffer as ArrayBuffer;
      const entry: PixelPatchEntry = {
        type: "pixel-patch",
        id: typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `history-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
        label,
        timestamp: Date.now(),
        byteSize: before.byteLength + after.byteLength,
        layerId: layer.id,
        rect: { x: 0, y: 0, width, height },
        before,
        after,
      };
      pushStrokeHistory(entry);
      setRenderError(null);
      syncLayerList(manager);
      requestRender();
    } catch (caught) {
      setRenderError(caught instanceof Error ? caught.message : "Could not apply the layer adjustment.");
    }
  }, [pushStrokeHistory, requestRender, selectedLayer, syncLayerList]);

  const undo = useCallback(() => {
    const current = historyRef.current;
    const entry = current.undoStack[current.undoStack.length - 1];
    if (!entry || entry.type !== "pixel-patch") return;
    if (!applyPixelPatch(entry, "before")) return;
    const next: HistoryState = {
      ...current,
      undoStack: current.undoStack.slice(0, -1),
      redoStack: [...current.redoStack, entry],
    };
    historyRef.current = next;
    setHistoryState(next);
    recordAction(`Undo · ${entry.label}`);
    requestRender();
  }, [applyPixelPatch, recordAction, requestRender]);

  const redo = useCallback(() => {
    const current = historyRef.current;
    const entry = current.redoStack[current.redoStack.length - 1];
    if (!entry || entry.type !== "pixel-patch") return;
    if (!applyPixelPatch(entry, "after")) return;
    const next: HistoryState = {
      ...current,
      undoStack: [...current.undoStack, entry],
      redoStack: current.redoStack.slice(0, -1),
    };
    historyRef.current = next;
    setHistoryState(next);
    recordAction(`Redo · ${entry.label}`);
    requestRender();
  }, [applyPixelPatch, recordAction, requestRender]);

  const handleWheel = useCallback((event: React.WheelEvent<HTMLElement>) => {
    event.preventDefault();
    zoomAt(event.clientX, event.clientY, Math.exp(-event.deltaY * 0.001));
  }, [zoomAt]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Browser may already capture it. */ }

    if (spacePressedRef.current || activeTool === "hand") {
      panPointerRef.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY };
      hasManualViewRef.current = true;
      return;
    }
    if (activeTool === "zoom") {
      zoomAt(event.clientX, event.clientY, 1.2);
      return;
    }

    const canvasContext = compositeCanvasRef.current?.getContext("2d");
    if (!canvasContext) return;
    if (activeTool === "move") {
      moveToolRef.current?.onMouseDown(event.nativeEvent, canvasContext, configRef.current.scale);
      return;
    }
    if (activeTool === "brush" || activeTool === "eraser") {
      strokeToolsRef.current[activeTool]?.onPointerDown(toToolPointerEvent(event.nativeEvent));
    }
  }, [activeTool, zoomAt]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const pan = panPointerRef.current;
    if (pan && pan.pointerId === event.pointerId) {
      const deltaX = event.clientX - pan.lastX;
      const deltaY = event.clientY - pan.lastY;
      panPointerRef.current = { ...pan, lastX: event.clientX, lastY: event.clientY };
      updateEditorConfig((current) => ({ ...current, panX: current.panX + deltaX, panY: current.panY + deltaY }));
      return;
    }

    const canvasContext = compositeCanvasRef.current?.getContext("2d");
    if (activeTool === "move" && canvasContext) {
      moveToolRef.current?.onMouseMove(event.nativeEvent, canvasContext, configRef.current.scale);
      return;
    }
    if (activeTool === "brush" || activeTool === "eraser") {
      strokeToolsRef.current[activeTool]?.onPointerMove(toToolPointerEvent(event.nativeEvent));
    }
  }, [activeTool, updateEditorConfig]);

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const pan = panPointerRef.current;
    if (pan && pan.pointerId === event.pointerId) {
      panPointerRef.current = null;
      return;
    }

    const canvasContext = compositeCanvasRef.current?.getContext("2d");
    if (activeTool === "move" && canvasContext) {
      moveToolRef.current?.onMouseUp(event.nativeEvent, canvasContext, configRef.current.scale);
      syncLayerList();
      requestRender();
    } else if (activeTool === "brush" || activeTool === "eraser") {
      strokeToolsRef.current[activeTool]?.onPointerUp(toToolPointerEvent(event.nativeEvent));
    }
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    } catch { /* Capture can be lost during tab changes or device cancellation. */ }
  }, [activeTool, requestRender, syncLayerList]);

  const handlePointerCancel = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (panPointerRef.current?.pointerId === event.pointerId) panPointerRef.current = null;
    strokeToolsRef.current.brush?.onPointerCancel();
    strokeToolsRef.current.eraser?.onPointerCancel();
    const canvasContext = compositeCanvasRef.current?.getContext("2d");
    if (canvasContext) moveToolRef.current?.onMouseUp(event.nativeEvent, canvasContext, configRef.current.scale);
  }, []);

  const handleImport = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const manager = layerManagerRef.current;
    if (!manager) return;

    const objectUrl = URL.createObjectURL(file);
    const image = new window.Image();
    image.onload = () => {
      try {
        const layer = manager.addLayer(file.name.replace(/\.[^.]+$/, "") || "Imported image", DOCUMENT_WIDTH, DOCUMENT_HEIGHT);
        const context = layer.canvasElement.getContext("2d");
        if (!context) throw new Error("Could not create a context for the imported image layer.");
        const fit = Math.min(DOCUMENT_WIDTH / image.naturalWidth, DOCUMENT_HEIGHT / image.naturalHeight);
        const width = image.naturalWidth * fit;
        const height = image.naturalHeight * fit;
        context.drawImage(image, (DOCUMENT_WIDTH - width) / 2, (DOCUMENT_HEIGHT - height) / 2, width, height);
        manager.setActiveLayer(layer.id);
        setSelectedLayer(layer.id);
        syncLayerList(manager);
        recordAction(`Imported ${file.name}`);
        requestRender();
      } catch (caught) {
        setRenderError(caught instanceof Error ? caught.message : "Could not import the image.");
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      setRenderError(`Could not decode image file: ${file.name}`);
    };
    image.src = objectUrl;
  }, [recordAction, requestRender, syncLayerList]);

  const exportPng = useCallback(() => {
    const canvas = compositeCanvasRef.current;
    const renderer = rendererRef.current;
    const manager = layerManagerRef.current;
    if (!canvas || !renderer || !manager) return;

    void renderer.render(canvas, manager.getLayers()).then(() => new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("PNG export failed: the browser did not provide an image blob."));
      }, "image/png");
    })).then((blob) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "glazephoto-export.png";
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      recordAction("PNG exported");
      setRenderError(null);
    }).catch((caught: unknown) => {
      const message = caught instanceof Error ? caught.message : "Unknown PNG export error.";
      setRenderError(message);
    });
  }, [recordAction]);

  useEffect(() => {
    const renderer = new Renderer();
    const manager = new LayerManager();
    rendererRef.current = renderer;
    layerManagerRef.current = manager;

    const background = manager.addLayer("Base photograph", DOCUMENT_WIDTH, DOCUMENT_HEIGHT);
    background.locked = true;
    drawArtwork(background.canvasElement);
    manager.addLayer("Alpine lake", DOCUMENT_WIDTH, DOCUMENT_HEIGHT);
    manager.addLayer("Mist & atmosphere", DOCUMENT_WIDTH, DOCUMENT_HEIGHT);
    const topLayer = manager.addLayer("Color grade", DOCUMENT_WIDTH, DOCUMENT_HEIGHT);
    manager.setActiveLayer(topLayer.id);
    setSelectedLayer(topLayer.id);
    syncLayerList(manager);

    const context: ToolContext = {
      getEditorConfig: () => configRef.current,
      getViewportRect: () => {
        const stage = stageRef.current;
        if (!stage) return { left: 0, top: 0 };
        const bounds = stage.getBoundingClientRect();
        return { left: bounds.left + stage.clientLeft, top: bounds.top + stage.clientTop };
      },
      getActiveLayer: () => {
        const activeId = manager.getActiveLayerId();
        return manager.getLayers().find((layer) => layer.id === activeId) ?? null;
      },
      getSelection: () => selectionRef.current,
      requestRender,
      pushHistory: pushStrokeHistory,
    };
    strokeToolsRef.current = {
      brush: new BrushTool(context),
      eraser: new EraserTool(context),
    };
    const outputCanvas = compositeCanvasRef.current;
    if (outputCanvas) moveToolRef.current = new MoveTool(manager, renderer, outputCanvas);

    const fitCanvasToStage = () => {
      const stage = stageRef.current;
      if (!stage || hasManualViewRef.current) return;
      const availableWidth = Math.max(1, stage.clientWidth - 36);
      const availableHeight = Math.max(1, stage.clientHeight - 36);
      const fitScale = Math.min(1, availableWidth / DOCUMENT_WIDTH, availableHeight / DOCUMENT_HEIGHT);
      updateEditorConfig((current) => ({
        ...current,
        scale: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, fitScale)),
        panX: (stage.clientWidth - DOCUMENT_WIDTH * fitScale) / 2,
        panY: (stage.clientHeight - DOCUMENT_HEIGHT * fitScale) / 2,
      }));
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === "Space" && !isEditableTarget(event.target)) {
        spacePressedRef.current = true;
        event.preventDefault();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        spacePressedRef.current = false;
        panPointerRef.current = null;
      }
    };
    const handleWindowBlur = () => {
      spacePressedRef.current = false;
      panPointerRef.current = null;
      strokeToolsRef.current.brush?.onPointerCancel();
      strokeToolsRef.current.eraser?.onPointerCancel();
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleWindowBlur);
    const resizeObserver = typeof ResizeObserver !== "undefined" && stageRef.current
      ? new ResizeObserver(fitCanvasToStage)
      : null;
    if (resizeObserver && stageRef.current) resizeObserver.observe(stageRef.current);
    const frame = window.requestAnimationFrame(() => {
      fitCanvasToStage();
      requestRender();
    });

    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleWindowBlur);
      strokeToolsRef.current.brush?.dispose();
      strokeToolsRef.current.eraser?.dispose();
      strokeToolsRef.current = {};
      moveToolRef.current = null;
      renderer.dispose();
      rendererRef.current = null;
      layerManagerRef.current = null;
      for (const layer of manager.getLayers()) {
        if (isRasterLayer(layer)) {
          layer.canvasElement.width = 0;
          layer.canvasElement.height = 0;
        }
      }
    };
  }, [pushStrokeHistory, redo, requestRender, syncLayerList, undo, updateEditorConfig]);

  return (
    <main className="editor-shell">
      <header className="topbar aero-glass aero-glossy">
        <div className="brand-lockup">
          <div className="brand-mark"><Aperture size={21} strokeWidth={1.8} /></div>
          <div>
            <div className="brand-name">GlazePhoto</div>
            <span className="brand-subtitle">Creative workspace</span>
          </div>
        </div>

        <div className="document-name">
          <span>Alpine dusk — study 04</span>
          <span className="document-meta">Edited locally · {DOCUMENT_WIDTH} × {DOCUMENT_HEIGHT} px</span>
        </div>

        <div className="topbar-actions">
          <input ref={importInputRef} type="file" accept="image/*" onChange={handleImport} hidden />
          <button className="icon-button aero-hover" aria-label="Upload image" title="Import image" onClick={() => importInputRef.current?.click()}>
            <Upload size={16} />
          </button>
          <button className="header-button aero-hover" onClick={() => recordAction("Workspace status checked")}>
            <Check size={14} /><span>Saved</span><ChevronDown size={13} />
          </button>
          <button className="export-button aero-glossy aero-hover" onClick={exportPng}>
            <Download size={15} /><span>Export PNG</span>
          </button>
        </div>
      </header>

      <nav className="toolstrip aero-glass aero-glossy" aria-label="Editor tools">
        <div className="toolbar-group">
          {tools.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`tool-button aero-hover ${activeTool === id ? "is-active aero-active-neon" : ""}`}
              onClick={() => selectTool(id)}
              aria-pressed={activeTool === id}
              title={label}
            >
              <Icon strokeWidth={1.8} />
              <span>{label}</span>
            </button>
          ))}
        </div>
        <div className="toolbar-divider" />
        <div className="toolbar-group">
          <button className="icon-button aero-hover" aria-label="Undo" title="Undo (Ctrl+Z)" onClick={undo} disabled={historyState.undoStack.length === 0}>
            <Undo2 size={16} />
          </button>
          <button className="icon-button aero-hover" aria-label="Redo" title="Redo (Ctrl+Y)" onClick={redo} disabled={historyState.redoStack.length === 0}>
            <Redo2 size={16} />
          </button>
          <button className="icon-button aero-hover" aria-label="Auto enhance selected layer" title="Auto enhance selected raster layer" onClick={() => applyLayerAdjustment("auto")}>
            <SlidersHorizontal size={16} />
          </button>
        </div>
      </nav>

      <section className="workspace">
        <aside className="side-panel left-panel aero-glass-dark" aria-label="Layers panel">
          <div className="panel-section">
            <div className="panel-title">
              <span className="panel-title-label"><Layers size={15} /> Layers</span>
              <div>
                <button className="small-icon-button aero-hover" aria-label="Search layers" onClick={() => recordAction("Layer search is not enabled yet")}><Search size={14} /></button>
                <button className="small-icon-button aero-hover" aria-label="Layer options" onClick={() => recordAction("Layer options opened")}><MoreHorizontal size={15} /></button>
              </div>
            </div>
            <div className="panel-caption">A thoughtful stack, beautifully composed</div>
            <div className="layer-list">
              {layers.map((layer, index) => (
                <div
                  key={layer.id}
                  className={`layer-row ${selectedLayer === layer.id ? "is-selected" : ""}`}
                  onClick={() => selectLayer(layer.id)}
                  onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) => {
                    if (event.key === "Enter" || event.key === " ") selectLayer(layer.id);
                  }}
                  role="button"
                  tabIndex={0}
                  aria-pressed={selectedLayer === layer.id}
                >
                  <div
                    className="layer-preview"
                    style={layer.type === "raster" ? { background: `linear-gradient(145deg, ${PREVIEW_COLORS[index % PREVIEW_COLORS.length]}, #263d4c 75%)` } : undefined}
                  >
                    {layer.type === "raster" ? <Image className="layer-preview-empty" size={16} /> : <span className="layer-preview-empty"><Sparkles size={14} /></span>}
                  </div>
                  <div className="layer-copy">
                    <span className="layer-name">{layer.name}</span>
                    <span className="layer-meta">{describeLayer(layer)}</span>
                  </div>
                  <button
                    className={`small-icon-button visibility-button ${layer.visible ? "is-visible" : ""}`}
                    aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
                    onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
                      event.stopPropagation();
                      toggleVisibility(layer.id);
                    }}
                  >
                    {layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                  </button>
                  {index === 0 && <span className="layer-accent" />}
                </div>
              ))}
            </div>
            <div className="panel-footer-actions">
              <button className="panel-action aero-hover" onClick={addLayer}><Plus size={13} /> New layer</button>
              <button className="panel-action aero-hover" onClick={removeSelectedLayer} aria-label="Delete selected layer" disabled={layers.length <= 1}><Trash2 size={13} /></button>
            </div>
          </div>

          <div className="panel-section">
            <div className="panel-title">
              <span className="panel-title-label"><Settings2 size={14} /> Layer properties</span>
              <button className="small-icon-button aero-hover" aria-label="Collapse properties"><ChevronDown size={14} /></button>
            </div>
            <label className="range-label" htmlFor="layer-opacity">
              <span>Opacity</span><span className="range-value">{Math.round((selectedLayerModel?.opacity ?? 1) * 100)}%</span>
            </label>
            <input id="layer-opacity" type="range" min="0" max="100" value={Math.round((selectedLayerModel?.opacity ?? 1) * 100)} onChange={(event: React.ChangeEvent<HTMLInputElement>) => changeLayerOpacity(Number(event.target.value))} disabled={!selectedLayerModel} />
            <label className="range-label" htmlFor="blend-mode"><span>Blend mode</span></label>
            <select className="blend-select" id="blend-mode" value={selectedLayerModel?.blendMode ?? BlendMode.Normal} onChange={(event: React.ChangeEvent<HTMLSelectElement>) => changeBlendMode(event.target.value as BlendMode)} disabled={!selectedLayerModel}>
              <option value={BlendMode.Normal}>Normal</option>
              <option value={BlendMode.Multiply}>Multiply</option>
              <option value={BlendMode.Screen}>Screen</option>
              <option value={BlendMode.Overlay}>Overlay</option>
              <option value={BlendMode.Darken}>Darken</option>
              <option value={BlendMode.Lighten}>Lighten</option>
              <option value={BlendMode.ColorDodge}>Color dodge</option>
              <option value={BlendMode.ColorBurn}>Color burn</option>
              <option value={BlendMode.HardLight}>Hard light</option>
              <option value={BlendMode.SoftLight}>Soft light</option>
              <option value={BlendMode.Difference}>Difference</option>
              <option value={BlendMode.Exclusion}>Exclusion</option>
              <option value={BlendMode.Hue}>Hue</option>
              <option value={BlendMode.Saturation}>Saturation</option>
              <option value={BlendMode.Color}>Color</option>
              <option value={BlendMode.Luminosity}>Luminosity</option>
            </select>
          </div>
        </aside>

        <section ref={stageRef} className="canvas-stage" aria-label="Canvas workspace" onWheel={handleWheel}>
          <div
            ref={canvasBoardRef}
            className="canvas-board canvas-shadow"
            style={{ width: DOCUMENT_WIDTH, height: DOCUMENT_HEIGHT, maxWidth: "none", maxHeight: "none", aspectRatio: "auto", cursor: activeTool === "brush" ? "crosshair" : activeTool === "eraser" ? "cell" : activeTool === "hand" || spacePressedRef.current ? "grab" : activeTool === "zoom" ? "zoom-in" : "default" }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onLostPointerCapture={handlePointerCancel}
          >
            <canvas ref={compositeCanvasRef} width={DOCUMENT_WIDTH} height={DOCUMENT_HEIGHT} aria-label="Alpine lake at dusk artwork" />
            <div className="canvas-top-label"><span /> Alpine dusk — study 04</div>
            <div className="canvas-hint">{renderError ? `Render error: ${renderError}` : `${DOCUMENT_WIDTH} × ${DOCUMENT_HEIGHT} px · RGBA`}</div>
          </div>
        </section>

        <aside className="side-panel right-panel aero-glass-dark" aria-label="History and brush settings">
          <div className="panel-section">
            <div className="panel-title">
              <span className="panel-title-label"><History size={15} /> History</span>
              <button className="small-icon-button aero-hover" aria-label="History options" onClick={() => recordAction("History stores pixel stroke patches") }><MoreHorizontal size={15} /></button>
            </div>
            <div className="panel-caption">A little room to experiment</div>
            <div className="history-list">
              {historyLabels.slice(0, 7).map((entry, index) => (
                <button
                  key={`${entry}-${index}`}
                  className={`history-item ${activeHistory === index ? "is-current" : ""}`}
                  onClick={() => setActiveHistory(index)}
                >
                  <span className="history-dot" />
                  <span>{entry}</span>
                  {index === 0 && <span className="history-time">now</span>}
                </button>
              ))}
            </div>
          </div>

          <div className="panel-section">
            <div className="panel-title">
              <span className="panel-title-label"><Brush size={15} /> Brush settings</span>
              <button className="small-icon-button aero-hover" aria-label="More brush settings" onClick={() => recordAction("Brush spacing and hardness use core defaults")}><MoreHorizontal size={15} /></button>
            </div>
            <div className="brush-preview">
              <span className="brush-preview-dot" style={{ width: brushSize, height: brushSize, backgroundColor: `${brushColor}88` }} />
            </div>
            <label className="range-label" htmlFor="brush-size">
              <span>Size</span><span className="range-value">{brushSize} px</span>
            </label>
            <input id="brush-size" type="range" min="2" max="120" value={brushSize} onChange={(event: React.ChangeEvent<HTMLInputElement>) => updateBrushSize(Number(event.target.value))} />
            <label className="range-label" htmlFor="brush-opacity">
              <span>Opacity</span><span className="range-value">{brushOpacity}%</span>
            </label>
            <input id="brush-opacity" type="range" min="1" max="100" value={brushOpacity} onChange={(event: React.ChangeEvent<HTMLInputElement>) => updateBrushOpacity(Number(event.target.value))} />
            <div className="range-label"><span>Color</span><span className="range-value">{brushColor.toUpperCase()}</span></div>
            <div className="swatch-row">
              {["#a8d8ff", "#e7b997", "#9cd8c2", "#d1b5ff", "#f1e6d2"].map((color) => (
                <button
                  key={color}
                  className={`swatch ${brushColor === color ? "is-active" : ""}`}
                  style={{ background: color }}
                  onClick={() => updateBrushColor(color)}
                  aria-label={`Set brush color ${color}`}
                />
              ))}
              <input className="color-input" type="color" value={brushColor} onChange={(event: React.ChangeEvent<HTMLInputElement>) => updateBrushColor(event.target.value)} aria-label="Custom brush color" />
            </div>
          </div>

          <div className="panel-section">
            <div className="panel-title">
              <span className="panel-title-label"><Sparkles size={14} /> Quick adjustments</span>
            </div>
            <button className="panel-action aero-hover" style={{ width: "100%" }} onClick={() => applyLayerAdjustment("auto")}>
              <Sun size={13} /> Auto enhance <ChevronDown size={12} />
            </button>
            <div className="panel-footer-actions">
              <button className="panel-action aero-hover" onClick={() => applyLayerAdjustment("exposure")}><Sun size={12} /> Exposure +0.35 EV</button>
              <button className="panel-action aero-hover" onClick={() => applyLayerAdjustment("contrast")}><Contrast size={12} /> Contrast +15%</button>
            </div>
          </div>
        </aside>
      </section>

      <footer className="statusbar">
        <div className="status-left">
          <span className="status-item"><span className="status-online" /> {renderError ? "Render issue" : "Renderer ready"}</span>
          <span className="status-item"><Image size={12} /> {DOCUMENT_WIDTH} × {DOCUMENT_HEIGHT}</span>
          <span className="status-item"><Droplet size={12} /> sRGB IEC61966-2.1</span>
        </div>
        <div className="status-right">
          <span>Canvas view</span>
          <div className="zoom-controls">
            <button className="zoom-button aero-hover" aria-label="Zoom out" onClick={() => zoomBy(-5)}><Minus size={12} /></button>
            <span className="zoom-value">{zoom}%</span>
            <button className="zoom-button aero-hover" aria-label="Zoom in" onClick={() => zoomBy(5)}><Plus size={12} /></button>
          </div>
          <button className="small-icon-button aero-hover" aria-label="Workspace settings"><PanelRightClose size={14} /></button>
        </div>
      </footer>
    </main>
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}
