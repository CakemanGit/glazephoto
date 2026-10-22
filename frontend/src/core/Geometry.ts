/**
 * GlazePhoto — геометрия и преобразование координат.
 * Файл: frontend/src/core/geometry.ts
 *
 * Чистые функции без состояния. Единственное место, где clientX/clientY
 * превращаются в координаты документа/слоя с учётом Zoom и Pan.
 */

import type { Point, Rect, SmartTransform, VectorPath } from "./types";

/** Параметры вида: см. EditorConfig (scale, panX, panY). */
export interface ViewTransform {
  scale: number;
  panX: number;
  panY: number;
}

/** Левый верхний угол контейнера просмотра в координатах окна (getBoundingClientRect). */
export interface ViewportOrigin {
  left: number;
  top: number;
}

/** Результат шага интерполяции вдоль отрезка. */
export interface StampInterpolation {
  /** Позиции штампов на отрезке (без начальной точки). */
  points: Point[];
  /** Расстояние, пройденное после последнего штампа (передавать в следующий вызов). */
  carry: number;
}

/** Ограничивает значение диапазоном [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** Масштаб, защищённый от нуля, отрицательных значений и NaN. */
function safeScale(scale: number): number {
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

/**
 * Координаты окна (clientX/clientY) → координаты документа.
 * Обратная операция к: client = origin + pan + doc * scale.
 */
export function clientToDocument(
  clientX: number,
  clientY: number,
  origin: ViewportOrigin,
  view: ViewTransform,
): Point {
  const scale = safeScale(view.scale);
  return {
    x: (clientX - origin.left - view.panX) / scale,
    y: (clientY - origin.top - view.panY) / scale,
  };
}

/** Координаты документа → координаты окна (для рисования курсора и оверлеев). */
export function documentToClient(
  point: Point,
  origin: ViewportOrigin,
  view: ViewTransform,
): Point {
  const scale = safeScale(view.scale);
  return {
    x: origin.left + view.panX + point.x * scale,
    y: origin.top + view.panY + point.y * scale,
  };
}

/** Координаты документа → координаты canvas слоя. */
export function documentToLayer(
  point: Point,
  layer: { offsetX: number; offsetY: number },
): Point {
  return { x: point.x - layer.offsetX, y: point.y - layer.offsetY };
}

/**
 * Линейная интерполяция штампов вдоль отрезка from → to с постоянным шагом.
 * Остаток пути между штампами переносится через `carry`, поэтому результат
 * не зависит от того, как движение мыши разбито на события: быстрые рывки
 * дают те же равномерные штампы без «дыр».
 */
export function interpolateStamps(
  from: Point,
  to: Point,
  step: number,
  carry: number,
): StampInterpolation {
  const safeStep = step > 0 && Number.isFinite(step) ? step : 1;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (!(distance > 0)) {
    return { points: [], carry };
  }

  const points: Point[] = [];
  let next = safeStep - carry;
  while (next <= distance) {
    const t = next / distance;
    points.push({ x: from.x + dx * t, y: from.y + dy * t });
    next += safeStep;
  }
  return { points, carry: distance - (next - safeStep) };
}

/** Пустой прямоугольник. */
export function emptyRect(): Rect {
  return { x: 0, y: 0, width: 0, height: 0 };
}

/** true, если у прямоугольника нет площади. */
export function isEmptyRect(rect: Rect): boolean {
  return rect.width <= 0 || rect.height <= 0;
}

/** Объединение двух прямоугольников (a может быть null). */
export function unionRect(a: Rect | null, b: Rect): Rect {
  if (a === null || isEmptyRect(a)) return { ...b };
  if (isEmptyRect(b)) return { ...a };
  const left = Math.min(a.x, b.x);
  const top = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.width, b.x + b.width);
  const bottom = Math.max(a.y + a.height, b.y + b.height);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Пересечение; если прямоугольники не пересекаются — пустой. */
export function intersectRect(a: Rect, b: Rect): Rect {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= left || bottom <= top) return emptyRect();
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Целочисленный прямоугольник, описанный вокруг окружности. */
export function circleBounds(center: Point, radius: number): Rect {
  const left = Math.floor(center.x - radius);
  const top = Math.floor(center.y - radius);
  const right = Math.ceil(center.x + radius);
  const bottom = Math.ceil(center.y + radius);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Габариты смарт-объекта после трансформации (целые пиксели, документные координаты).
 * Допуск EPS убирает ошибки округления sin/cos на углах 90°, 180° и т.д.
 */
export function getSmartObjectBounds(
  naturalWidth: number,
  naturalHeight: number,
  transform: SmartTransform,
): Rect {
  const EPS = 1e-6;
  const halfW0 = Math.abs(naturalWidth * transform.scaleX) / 2;
  const halfH0 = Math.abs(naturalHeight * transform.scaleY) / 2;
  const cos = Math.abs(Math.cos(transform.rotation));
  const sin = Math.abs(Math.sin(transform.rotation));
  const halfW = halfW0 * cos + halfH0 * sin;
  const halfH = halfW0 * sin + halfH0 * cos;
  const left = Math.floor(transform.centerX - halfW + EPS);
  const top = Math.floor(transform.centerY - halfH + EPS);
  const right = Math.ceil(transform.centerX + halfW - EPS);
  const bottom = Math.ceil(transform.centerY + halfH - EPS);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Векторный контур → Path2D. Координаты сдвигаются на (-offsetX, -offsetY),
 * чтобы контур документа можно было рисовать прямо в canvas слоя.
 * Замкнутый контур замыкается кривой от последней точки к первой.
 */
export function vectorPathToPath2D(
  path: VectorPath,
  offsetX: number,
  offsetY: number,
): Path2D {
  const result = new Path2D();
  const anchors = path.anchors;
  const first = anchors[0];
  if (first === undefined) return result;

  result.moveTo(first.position.x - offsetX, first.position.y - offsetY);
  for (let i = 1; i < anchors.length; i += 1) {
    const previous = anchors[i - 1];
    const current = anchors[i];
    if (previous === undefined || current === undefined) continue;
    result.bezierCurveTo(
      previous.handleOut.x - offsetX,
      previous.handleOut.y - offsetY,
      current.handleIn.x - offsetX,
      current.handleIn.y - offsetY,
      current.position.x - offsetX,
      current.position.y - offsetY,
    );
  }

  if (path.closed && anchors.length > 1) {
    const last = anchors[anchors.length - 1];
    if (last !== undefined) {
      result.bezierCurveTo(
        last.handleOut.x - offsetX,
        last.handleOut.y - offsetY,
        first.handleIn.x - offsetX,
        first.handleIn.y - offsetY,
        first.position.x - offsetX,
        first.position.y - offsetY,
      );
    }
    result.closePath();
  }
  return result;
}