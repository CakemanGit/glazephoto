/** Base contract for tools that respond to canvas mouse events. */
export abstract class BaseTool {
  /** True while this tool is handling an active mouse-drag operation. */
  protected isDrawing = false;

  /** Handles the start of a mouse interaction on the canvas. */
  abstract onMouseDown(
    e: MouseEvent,
    ctx: CanvasRenderingContext2D,
    scale: number,
  ): void;

  /** Handles pointer movement on the canvas. */
  abstract onMouseMove(
    e: MouseEvent,
    ctx: CanvasRenderingContext2D,
    scale: number,
  ): void;

  /** Handles the end of a mouse interaction on the canvas. */
  abstract onMouseUp(
    e: MouseEvent,
    ctx: CanvasRenderingContext2D,
    scale: number,
  ): void;
}