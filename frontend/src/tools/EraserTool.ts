/**
 * GlazePhoto — инструмент «Ластик».
 * Файл: frontend/src/tools/EraserTool.ts
 *
 * Использует тот же движок мазка, что и кисть, но вместо нанесения цвета
 * вычитает мазок из альфа-канала слоя (destination-out).
 */

import type { EditorConfig } from "../core/types";
import type { StrokeParams } from "./Strokeengine";
import { StrokeTool } from "./Stroketool";
import type { ToolContext } from "./Tool";

export class EraserTool extends StrokeTool {
  readonly id = "eraser" as const;

  constructor(context: ToolContext) {
    super(context, "erase", "Eraser stroke");
  }

  protected resolveParams(config: EditorConfig): StrokeParams {
    const eraser = config.tools.eraser;
    return {
      size: eraser.size,
      hardness: eraser.hardness,
      opacity: eraser.opacity,
      flow: 1,
      spacing: eraser.spacing,
      // Цвет при стирании не используется: важен только альфа-канал мазка.
      color: { r: 0, g: 0, b: 0, a: 1 },
    };
  }
}