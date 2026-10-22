import { DEFAULT_EDITOR_CONFIG, type EditorConfig } from "../core/types";

const MIN_SCALE = 0.05;
const MAX_SCALE = 20;
const ZOOM_SENSITIVITY = 0.001;

/** Handles cursor-centered zooming and Space+drag panning for a canvas view. */
export class ZoomPanManager {
  private readonly config: EditorConfig;
  private spacePressed = false;
  private isPanning = false;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private attached = false;

  constructor(
    private readonly viewport: HTMLElement,
    initialConfig: EditorConfig = DEFAULT_EDITOR_CONFIG,
  ) {
    if (!Number.isFinite(initialConfig.scale) || initialConfig.scale <= 0) {
      throw new RangeError("Initial scale must be a positive finite number.");
    }
    if (
      !Number.isFinite(initialConfig.panX) ||
      !Number.isFinite(initialConfig.panY)
    ) {
      throw new RangeError("Initial pan offsets must be finite numbers.");
    }

    this.config = { ...initialConfig };
    this.viewport.style.transformOrigin = "0 0";
    this.updateTransform();
    this.attach();
  }

  get scale(): number {
    return this.config.scale;
  }

  get panX(): number {
    return this.config.panX;
  }

  get panY(): number {
    return this.config.panY;
  }

  /** Returns the current editor view configuration. */
  getConfig(): EditorConfig {
    return { ...this.config };
  }

  /** Returns a CSS transform suitable for applying to the canvas container. */
  getTransform(): string {
    return `translate(${this.config.panX}px, ${this.config.panY}px) scale(${this.config.scale})`;
  }

  /** Removes the event listeners installed by this manager. */
  dispose(): void {
    if (!this.attached) {
      return;
    }

    this.viewport.removeEventListener("wheel", this.handleWheel);
    this.viewport.removeEventListener("mousedown", this.handleMouseDown);
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    window.removeEventListener("mousemove", this.handleMouseMove);
    window.removeEventListener("mouseup", this.handleMouseUp);
    window.removeEventListener("blur", this.handleBlur);
    this.attached = false;
    this.spacePressed = false;
    this.isPanning = false;
  }

  private attach(): void {
    this.viewport.addEventListener("wheel", this.handleWheel, { passive: false });
    this.viewport.addEventListener("mousedown", this.handleMouseDown);
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    window.addEventListener("mousemove", this.handleMouseMove);
    window.addEventListener("mouseup", this.handleMouseUp);
    window.addEventListener("blur", this.handleBlur);
    this.attached = true;
  }

  private readonly handleWheel = (event: WheelEvent): void => {
    event.preventDefault();

    const bounds = (
      this.viewport.parentElement ?? this.viewport
    ).getBoundingClientRect();
    const cursorX = event.clientX - bounds.left;
    const cursorY = event.clientY - bounds.top;
    const worldX = (cursorX - this.config.panX) / this.config.scale;
    const worldY = (cursorY - this.config.panY) / this.config.scale;
    const nextScale = Math.min(
      MAX_SCALE,
      Math.max(
        MIN_SCALE,
        this.config.scale * Math.exp(-event.deltaY * ZOOM_SENSITIVITY),
      ),
    );

    this.config.scale = nextScale;
    this.config.panX = cursorX - worldX * nextScale;
    this.config.panY = cursorY - worldY * nextScale;
    this.updateTransform();
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.code === "Space" && !this.isEditableTarget(event.target)) {
      event.preventDefault();
      this.spacePressed = true;
    }
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    if (event.code === "Space") {
      this.spacePressed = false;
      this.isPanning = false;
    }
  };

  private readonly handleMouseDown = (event: MouseEvent): void => {
    if (!this.spacePressed || event.button !== 0) {
      return;
    }

    event.preventDefault();
    this.isPanning = true;
    this.lastPointerX = event.clientX;
    this.lastPointerY = event.clientY;
  };

  private readonly handleMouseMove = (event: MouseEvent): void => {
    if (!this.isPanning) {
      return;
    }

    this.config.panX += event.clientX - this.lastPointerX;
    this.config.panY += event.clientY - this.lastPointerY;
    this.lastPointerX = event.clientX;
    this.lastPointerY = event.clientY;
    this.updateTransform();
  };

  private readonly handleMouseUp = (): void => {
    this.isPanning = false;
  };

  private readonly handleBlur = (): void => {
    this.spacePressed = false;
    this.isPanning = false;
  };

  private updateTransform(): void {
    this.viewport.style.transform = this.getTransform();
  }

  private isEditableTarget(target: EventTarget | null): boolean {
    return (
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement)
    );
  }
}