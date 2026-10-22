/**
 * GlazePhoto — инструмент «Кисть».
 * Файл: frontend/src/tools/BrushTool.ts
 *
 * Мазок строится линейной интерполяцией штампов с постоянным шагом
 * (size × spacing) — линия непрерывна при любой скорости движения.
 * Размер кисти задаётся в пикселях документа и не зависит от масштаба просмотра.
 */

import type { EditorConfig } from "../core/types";
import type { StrokeParams } from "./Strokeengine";
import { StrokeTool } from "./Stroketool";
import type { ToolContext } from "./Tool";

export class BrushTool extends StrokeTool {
  readonly id = "brush" as const;

  constructor(context: ToolContext) {
    super(context, "paint", "Brush stroke");
  }

  protected resolveParams(config: EditorConfig): StrokeParams {
    const brush = config.tools.brush;
    return {
      size: brush.size,
      hardness: brush.hardness,
      opacity: brush.opacity,
      flow: brush.flow,
      spacing: brush.spacing,
      color: brush.color,
    };
  }
}