/**
 * GlazePhoto — архитектурный фундамент.
 * Файл: frontend/src/core/types.ts
 *
 * Содержит ТОЛЬКО типы, константы по умолчанию и чистые функции без побочных эффектов.
 * Безопасен для импорта и из React-компонентов, и из Web Worker (нет зависимостей от React).
 *
 * Система координат:
 *  - «документ» — пиксели итогового изображения (0,0 — левый верхний угол);
 *  - «слой» — пиксели canvas слоя; точка слоя = точка документа − (offsetX, offsetY);
 *  - «клиент» — clientX/clientY браузера (CSS-пиксели окна).
 */

/* ========================================================================== */
/* 1. БАЗОВЫЕ ПРИМИТИВЫ                                                        */
/* ========================================================================== */

/** Идентификатор сущности (слой, контур, макрос и т.д.). */
export type EntityId = string;

/**
 * Standard CSS blend modes used to combine a layer's pixels with the content
 * beneath it.
 */
export enum BlendMode {
  /** Displays the source pixels without blending. */
  Normal = "normal",
  /** Multiplies the source and backdrop colors, producing a darker result. */
  Multiply = "multiply",
  /** Multiplies the inverse of the source and backdrop colors. */
  Screen = "screen",
  /** Combines multiply and screen according to the backdrop color. */
  Overlay = "overlay",
  /** Selects the darker color channel by channel. */
  Darken = "darken",
  /** Selects the lighter color channel by channel. */
  Lighten = "lighten",
  /** Brightens the backdrop by decreasing its contrast. */
  ColorDodge = "color-dodge",
  /** Darkens the backdrop by increasing its contrast. */
  ColorBurn = "color-burn",
  /** Combines multiply and screen according to the source color. */
  HardLight = "hard-light",
  /** Applies a softer variant of hard-light. */
  SoftLight = "soft-light",
  /** Subtracts the darker color from the lighter color. */
  Difference = "difference",
  /** Produces a lower-contrast variant of difference. */
  Exclusion = "exclusion",
  /** Uses the source hue with the backdrop saturation and luminosity. */
  Hue = "hue",
  /** Uses the source saturation with the backdrop hue and luminosity. */
  Saturation = "saturation",
  /** Uses the source hue and saturation with the backdrop luminosity. */
  Color = "color",
  /** Uses the source luminosity with the backdrop hue and saturation. */
  Luminosity = "luminosity",
}

/**
 * Режимы наложения, для которых в Web Worker реализованы собственные
 * математические формулы (остальные пока откатываются на Normal).
 */
export const WORKER_BLEND_MODES: readonly BlendMode[] = [
  BlendMode.Normal,
  BlendMode.Multiply,
  BlendMode.Screen,
  BlendMode.Overlay,
  BlendMode.Darken,
  BlendMode.Lighten,
  BlendMode.ColorDodge,
  BlendMode.Difference,
] as const;

/** A two-dimensional coordinate in the editor's coordinate space. */
export interface Point {
  /** Horizontal coordinate. */
  x: number;
  /** Vertical coordinate. */
  y: number;
}

/** Прямоугольник в целых пикселях. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Цвет RGBA: r/g/b в диапазоне 0..255, a в диапазоне 0..1. */
export interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

/* ========================================================================== */
/* 2. КОРРЕКТИРУЮЩИЕ СЛОИ (недеструктивные)                                    */
/* ========================================================================== */

/** Яркость/Контраст. Оба значения в диапазоне -100..100. */
export interface BrightnessContrastParams {
  kind: "brightnessContrast";
  brightness: number;
  contrast: number;
}

/** Сдвиг по трём цветовым осям для одного тонального диапазона, -100..100. */
export interface ColorShift {
  /** Голубой (-) ↔ Красный (+). */
  cyanRed: number;
  /** Пурпурный (-) ↔ Зелёный (+). */
  magentaGreen: number;
  /** Жёлтый (-) ↔ Синий (+). */
  yellowBlue: number;
}

/** Цветовой баланс по теням, средним тонам и светам. */
export interface ColorBalanceParams {
  kind: "colorBalance";
  shadows: ColorShift;
  midtones: ColorShift;
  highlights: ColorShift;
  /** Сохранять исходную яркость пикселя после сдвига. */
  preserveLuminosity: boolean;
}

/** Инверсия цветов (альфа-канал не меняется). */
export interface InvertParams {
  kind: "invert";
}

/** Контрольная точка кривой: вход x → выход y, оба в диапазоне 0..255. */
export interface CurvePoint {
  x: number;
  y: number;
}

/** Каналы, которые можно править независимо (rgb — композитный). */
export type ToneChannel = "rgb" | "red" | "green" | "blue";

/**
 * Кривые. Для каждого канала — список контрольных точек, отсортированных по x
 * (минимум 2 точки). Из них строится LUT на 256 значений (монотонный сплайн).
 */
export interface CurvesParams {
  kind: "curves";
  channels: Record<ToneChannel, CurvePoint[]>;
}

/** Уровни одного канала. */
export interface LevelsChannel {
  /** Чёрная точка входа, 0..254. */
  inputBlack: number;
  /** Белая точка входа, 1..255 (строго больше inputBlack). */
  inputWhite: number;
  /** Гамма средних тонов, 0.1..9.99 (1 — без изменений). */
  gamma: number;
  /** Чёрная точка выхода, 0..255. */
  outputBlack: number;
  /** Белая точка выхода, 0..255. */
  outputWhite: number;
}

/** Уровни по композитному и отдельным каналам. */
export interface LevelsParams {
  kind: "levels";
  channels: Record<ToneChannel, LevelsChannel>;
}

/** Параметры любого поддерживаемого корректирующего эффекта. */
export type AdjustmentParams =
  | BrightnessContrastParams
  | ColorBalanceParams
  | InvertParams
  | CurvesParams
  | LevelsParams;

/** Строковый тип эффекта (дискриминант AdjustmentParams). */
export type AdjustmentKind = AdjustmentParams["kind"];

/* ========================================================================== */
/* 3. ВЕКТОРНЫЕ КОНТУРЫ И МАСКИ (кривые Безье)                                 */
/* ========================================================================== */

/**
 * Опорная точка контура. Ручки заданы в АБСОЛЮТНЫХ координатах документа.
 * Если ручка совпадает с position — сегмент прямой на этой стороне.
 */
export interface BezierAnchor {
  position: Point;
  /** Входящая ручка (управляет кривой от предыдущей точки). */
  handleIn: Point;
  /** Исходящая ручка (управляет кривой к следующей точке). */
  handleOut: Point;
}

/** Один векторный контур (замкнутый или разомкнутый). */
export interface VectorPath {
  id: EntityId;
  name: string;
  anchors: BezierAnchor[];
  /** Замкнут ли контур (последняя точка соединена с первой). */
  closed: boolean;
}

/** Как несколько контуров комбинируются в одну маску. */
export type MaskCombineMode = "add" | "subtract" | "intersect";

/** Контур вместе со способом комбинирования. */
export interface MaskPathEntry {
  path: VectorPath;
  combine: MaskCombineMode;
}

/**
 * Маска слоя на основе векторных контуров.
 * Растеризованный результат (8-бит альфа) кэшируется и пересоздаётся
 * при изменении контуров — поле `revision` служит ключом инвалидации.
 */
export interface LayerMask {
  id: EntityId;
  enabled: boolean;
  /** Инвертировать маску (показывать вне контуров). */
  inverted: boolean;
  /** Радиус растушёвки в пикселях (0 = без растушёвки). */
  feather: number;
  paths: MaskPathEntry[];
  /** Увеличивается при каждом изменении контуров. */
  revision: number;
  /** Кэш растеризации: 8-бит альфа размером width*height слоя. */
  rasterCache: Uint8ClampedArray | null;
  /** Ревизия, для которой построен rasterCache. */
  rasterCacheRevision: number;
}

/* ========================================================================== */
/* 4. ЭФФЕКТЫ СЛОЯ (Layer Styles / FX)                                         */
/* ========================================================================== */

/** Тень. Строится из альфа-канала слоя, смещается по углу и размывается. */
export interface DropShadowStyle {
  enabled: boolean;
  /** Цвет тени (канал a игнорируется — используйте opacity). */
  color: RgbaColor;
  /** Непрозрачность, 0..1. */
  opacity: number;
  /** Направление света в градусах, 0..360 (тень падает в противоположную сторону). */
  angle: number;
  /** Смещение в пикселях. */
  distance: number;
  /** Размер (радиус размытия) в пикселях. */
  size: number;
  /** Расширение тени до размытия, 0..100 (%). */
  spread: number;
  blendMode: BlendMode;
}

/** Внутреннее свечение: градиент от края альфа-канала внутрь слоя. */
export interface InnerGlowStyle {
  enabled: boolean;
  color: RgbaColor;
  opacity: number;
  /** Откуда светится: от границы объекта или от его центра. */
  source: "edge" | "center";
  /** Размер свечения в пикселях. */
  size: number;
  /** Сжатие плавного перехода, 0..100 (%). */
  choke: number;
  blendMode: BlendMode;
}

/** Обводка по контуру альфа-канала. */
export interface StrokeStyle {
  enabled: boolean;
  color: RgbaColor;
  opacity: number;
  /** Толщина в пикселях. */
  width: number;
  position: "outside" | "inside" | "center";
  blendMode: BlendMode;
}

/** Все эффекты слоя. Порядок рендера: тень → слой → внутреннее свечение → обводка. */
export interface LayerStyles {
  dropShadow: DropShadowStyle;
  innerGlow: InnerGlowStyle;
  stroke: StrokeStyle;
}

/* ========================================================================== */
/* 5. СМАРТ-ОБЪЕКТЫ                                                            */
/* ========================================================================== */

/**
 * Исходник смарт-объекта в ПОЛНОМ разрешении. Никогда не перезаписывается
 * при трансформациях — ImageData создаётся заново при каждом изменении transform.
 */
export type SmartObjectSource =
  | {
      kind: "raster";
      /** MIME-тип закодированного файла (image/png, image/jpeg, image/webp). */
      mimeType: string;
      /** Закодированный файл как есть. */
      data: ArrayBuffer;
      naturalWidth: number;
      naturalHeight: number;
    }
  | {
      kind: "svg";
      svgText: string;
      naturalWidth: number;
      naturalHeight: number;
    };

/**
 * Трансформация смарт-объекта относительно его исходного размера.
 * Порядок применения: масштаб → поворот вокруг центра → перенос центра в (centerX, centerY).
 */
export interface SmartTransform {
  /** Положение центра исходника в координатах документа. */
  centerX: number;
  centerY: number;
  /** Множители относительно naturalWidth/naturalHeight; отрицательное значение = отражение. */
  scaleX: number;
  scaleY: number;
  /** Поворот по часовой стрелке, радианы. */
  rotation: number;
}

/* ========================================================================== */
/* 6. ТЕКСТ                                                                    */
/* ========================================================================== */

export type TextAlign = "left" | "center" | "right";

/** Оформление текста. */
export interface TextStyleConfig {
  /** CSS font-family (список через запятую). */
  fontFamily: string;
  /** Размер в пикселях документа. */
  fontSize: number;
  /** 100..900. */
  fontWeight: number;
  italic: boolean;
  /** Трекинг в тысячных долях em (как в типографике): 100 = 0.1em между символами. */
  tracking: number;
  /** Межстрочный интервал — множитель fontSize. */
  lineHeight: number;
  align: TextAlign;
  color: RgbaColor;
}

/* ========================================================================== */
/* 7. СЛОИ                                                                     */
/* ========================================================================== */

/** Тип слоя — дискриминант объединения Layer. */
export type LayerType = "raster" | "adjustment" | "smartObject" | "text";

/** Поля, общие для всех типов слоёв. */
export interface BaseLayer {
  /** Unique identifier for this layer. */
  id: EntityId;
  /** User-facing layer name. */
  name: string;
  /**
   * Размер области слоя в пикселях. Для растрового слоя — размер canvas,
   * для смарт-объекта и текста — вычисляемые границы содержимого.
   */
  width: number;
  height: number;
  /** Horizontal position of the layer on the editor canvas, in canvas pixels. */
  offsetX: number;
  /** Vertical position of the layer on the editor canvas, in canvas pixels. */
  offsetY: number;
  /** Layer opacity, in the range from 0 to 1. */
  opacity: number;
  /** Whether the layer is included in the rendered image. */
  visible: boolean;
  /** Blend mode used to composite this layer. */
  blendMode: BlendMode;
  /** Запрет редактирования пикселей/параметров. */
  locked: boolean;
  /** Векторная маска слоя или null. */
  mask: LayerMask | null;
  /** Динамические эффекты слоя. */
  styles: LayerStyles;
}

/** A drawable image layer managed by the editor. */
export interface RasterLayer extends BaseLayer {
  type: "raster";
  /** Canvas containing this layer's pixel content. */
  canvasElement: HTMLCanvasElement;
}

/**
 * Корректирующий слой: НЕ хранит пикселей, применяет функцию
 * ко всему, что находится под ним (с учётом маски и opacity).
 */
export interface AdjustmentLayer extends BaseLayer {
  type: "adjustment";
  adjustment: AdjustmentParams;
}

/**
 * Смарт-объект: хранит исходник и трансформацию. width/height/offsetX/offsetY —
 * габариты результата трансформации (пересчитываются при каждом изменении transform).
 */
export interface SmartObjectLayer extends BaseLayer {
  type: "smartObject";
  source: SmartObjectSource;
  transform: SmartTransform;
}

/**
 * Текстовый слой: хранит строку и оформление, пиксели строятся динамически.
 * width/height/offsetX/offsetY — габариты отрисованного текста.
 */
export interface TextLayer extends BaseLayer {
  type: "text";
  text: string;
  style: TextStyleConfig;
  /** Ширина блока для переноса строк; null — без переноса (точечный текст). */
  boxWidth: number | null;
}

/** Любой слой редактора. Сужайте тип через isRasterLayer / isAdjustmentLayer / … */
export type Layer = RasterLayer | AdjustmentLayer | SmartObjectLayer | TextLayer;

/** Свойства слоя, которые можно менять без перезаписи пикселей. */
export type LayerProps = Pick<
  BaseLayer,
  "name" | "offsetX" | "offsetY" | "opacity" | "visible" | "blendMode" | "locked"
>;

export function isRasterLayer(layer: Layer): layer is RasterLayer {
  return layer.type === "raster";
}

export function isAdjustmentLayer(layer: Layer): layer is AdjustmentLayer {
  return layer.type === "adjustment";
}

export function isSmartObjectLayer(layer: Layer): layer is SmartObjectLayer {
  return layer.type === "smartObject";
}

export function isTextLayer(layer: Layer): layer is TextLayer {
  return layer.type === "text";
}

/* ========================================================================== */
/* 8. ВЫДЕЛЕНИЕ                                                                */
/* ========================================================================== */

/** Как новое выделение сочетается с уже существующим. */
export type SelectionCombineMode = "replace" | "add" | "subtract" | "intersect";

/**
 * Текущее выделение (всегда в координатах ДОКУМЕНТА).
 * bitmap — результат Волшебной палочки: alpha.length === bounds.width * bounds.height,
 * значение 0..255 — степень выделенности пикселя.
 */
export type SelectionState =
  | { kind: "none" }
  | { kind: "rect"; rect: Rect }
  | { kind: "path"; path: VectorPath; feather: number }
  | { kind: "bitmap"; bounds: Rect; alpha: Uint8ClampedArray };

/* ========================================================================== */
/* 9. КОНФИГУРАЦИЯ ИНСТРУМЕНТОВ                                                */
/* ========================================================================== */

export type ToolId =
  | "move"
  | "hand"
  | "zoom"
  | "marquee"
  | "magicWand"
  | "brush"
  | "eraser"
  | "pen"
  | "gradient"
  | "fill"
  | "text"
  | "eyedropper";

export interface BrushConfig {
  /** Диаметр в пикселях документа (не зависит от масштаба просмотра). */
  size: number;
  /** Жёсткость края, 0..1. */
  hardness: number;
  /** Общая непрозрачность мазка, 0..1. */
  opacity: number;
  /** Интенсивность нанесения за один штамп, 0..1. */
  flow: number;
  /** Шаг штампов в долях диаметра (0.01..1) для интерполяции. */
  spacing: number;
  color: RgbaColor;
}

export interface EraserConfig {
  size: number;
  hardness: number;
  opacity: number;
  spacing: number;
}

export interface MarqueeConfig {
  /** Растушёвка выделения, px. */
  feather: number;
  /** Сглаживание краёв. */
  antiAlias: boolean;
}

/** Волшебная палочка: сегментация по цвету на основе Flood Fill. */
export interface MagicWandConfig {
  /** Допуск цвета 0..255 (максимальная разница по любому каналу). */
  tolerance: number;
  /** true — только связная область; false — все похожие пиксели документа. */
  contiguous: boolean;
  /** Анализировать итоговое изображение, а не только активный слой. */
  sampleAllLayers: boolean;
  /** Сглаживать края выделения. */
  antiAlias: boolean;
  /** Как сочетать с текущим выделением. */
  combine: SelectionCombineMode;
}

export interface PenToolConfig {
  /** Режим комбинирования нового контура с маской. */
  combine: MaskCombineMode;
  /** Радиус захвата опорной точки, px (в экранных координатах). */
  snapRadius: number;
  /** Показывать ручки Безье. */
  showHandles: boolean;
}

/** Опорная точка градиента: позиция 0..1 вдоль градиентной линии. */
export interface GradientStop {
  id: EntityId;
  position: number;
  color: RgbaColor;
}

export type GradientType = "linear" | "radial";

export interface GradientConfig {
  type: GradientType;
  /** Минимум 2 точки, отсортированы по position. */
  stops: GradientStop[];
  /** Прозрачность всего градиента, 0..1. */
  opacity: number;
  /** Перевернуть порядок цветов. */
  reverse: boolean;
  /** Режим наложения при нанесении на слой. */
  blendMode: BlendMode;
}

export interface FloodFillConfig {
  /** Допуск цвета 0..255 (расстояние по каналам). */
  tolerance: number;
  /** true — только связная область; false — все похожие пиксели. */
  contiguous: boolean;
  /** Анализировать итоговое изображение, а не только активный слой. */
  sampleAllLayers: boolean;
  antiAlias: boolean;
  color: RgbaColor;
}

/** Настройки инструмента «Текст» — значения для нового текстового слоя. */
export interface TextToolConfig {
  style: TextStyleConfig;
  /** Создавать блок с переносом строк (true) или точечный текст (false). */
  wrapInBox: boolean;
}

export interface MoveConfig {
  /** Автовыбор слоя под курсором. */
  autoSelectLayer: boolean;
}

export interface EyedropperConfig {
  /** Радиус усреднения в пикселях (0 = один пиксель). */
  sampleRadius: number;
  sampleAllLayers: boolean;
}

/** Настройки всех инструментов (hand/zoom без настроек). */
export interface ToolSettings {
  move: MoveConfig;
  marquee: MarqueeConfig;
  magicWand: MagicWandConfig;
  brush: BrushConfig;
  eraser: EraserConfig;
  pen: PenToolConfig;
  gradient: GradientConfig;
  fill: FloodFillConfig;
  text: TextToolConfig;
  eyedropper: EyedropperConfig;
}

/**
 * View and tool settings for the editor.
 *
 * Преобразование вида: точка документа d отображается в точку окна просмотра
 * (panX + d.x * scale, panY + d.y * scale), где (0,0) окна — левый верхний угол
 * контейнера просмотра. CSS: transform-origin: 0 0; transform: translate(panX px, panY px) scale(scale).
 */
export interface EditorConfig {
  /** Current canvas zoom scale. */
  scale: number;
  /** Horizontal view offset (CSS-пиксели). */
  panX: number;
  /** Vertical view offset (CSS-пиксели). */
  panY: number;
  /** Identifier of the currently active tool. */
  activeToolId: ToolId;
  /** Настройки инструментов. */
  tools: ToolSettings;
}

/** Границы масштабирования. */
export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 32;

/* ========================================================================== */
/* 10. ИСТОРИЯ UNDO/REDO С ЛИМИТОМ ПАМЯТИ                                      */
/* ========================================================================== */

/**
 * Снимок слоя без DOM-объектов: пиксели хранятся как RGBA-буфер.
 * Используется историей для восстановления удалённых слоёв.
 */
export interface RasterLayerSnapshot {
  type: "raster";
  id: EntityId;
  props: LayerProps;
  width: number;
  height: number;
  /** RGBA, длина width*height*4. */
  pixels: ArrayBuffer;
  mask: LayerMask | null;
  styles: LayerStyles;
}

export interface AdjustmentLayerSnapshot {
  type: "adjustment";
  id: EntityId;
  props: LayerProps;
  width: number;
  height: number;
  adjustment: AdjustmentParams;
  mask: LayerMask | null;
  styles: LayerStyles;
}

export interface SmartObjectLayerSnapshot {
  type: "smartObject";
  id: EntityId;
  props: LayerProps;
  width: number;
  height: number;
  source: SmartObjectSource;
  transform: SmartTransform;
  mask: LayerMask | null;
  styles: LayerStyles;
}

export interface TextLayerSnapshot {
  type: "text";
  id: EntityId;
  props: LayerProps;
  width: number;
  height: number;
  text: string;
  style: TextStyleConfig;
  boxWidth: number | null;
  mask: LayerMask | null;
  styles: LayerStyles;
}

export type LayerSnapshot =
  | RasterLayerSnapshot
  | AdjustmentLayerSnapshot
  | SmartObjectLayerSnapshot
  | TextLayerSnapshot;

/** Поля, общие для всех записей истории. */
export interface HistoryEntryBase {
  id: EntityId;
  label: string;
  timestamp: number;
  /** Приблизительный объём памяти записи в байтах (для лимита). */
  byteSize: number;
}

/** Изменение пикселей в прямоугольной области слоя (дифф «до/после»). */
export interface PixelPatchEntry extends HistoryEntryBase {
  type: "pixel-patch";
  layerId: EntityId;
  /** Область в координатах канваса слоя. */
  rect: Rect;
  /** RGBA «до», длина rect.width*rect.height*4. */
  before: ArrayBuffer;
  /** RGBA «после». */
  after: ArrayBuffer;
}

export interface LayerAddEntry extends HistoryEntryBase {
  type: "layer-add";
  index: number;
  snapshot: LayerSnapshot;
}

export interface LayerRemoveEntry extends HistoryEntryBase {
  type: "layer-remove";
  index: number;
  snapshot: LayerSnapshot;
}

export interface LayerReorderEntry extends HistoryEntryBase {
  type: "layer-reorder";
  layerId: EntityId;
  fromIndex: number;
  toIndex: number;
}

export interface LayerPropsEntry extends HistoryEntryBase {
  type: "layer-props";
  layerId: EntityId;
  before: Partial<LayerProps>;
  after: Partial<LayerProps>;
}

export interface LayerStylesEntry extends HistoryEntryBase {
  type: "layer-styles";
  layerId: EntityId;
  before: LayerStyles;
  after: LayerStyles;
}

export interface AdjustmentChangeEntry extends HistoryEntryBase {
  type: "adjustment-change";
  layerId: EntityId;
  before: AdjustmentParams;
  after: AdjustmentParams;
}

export interface SmartTransformEntry extends HistoryEntryBase {
  type: "smart-transform";
  layerId: EntityId;
  before: SmartTransform;
  after: SmartTransform;
}

/** Содержимое текстового слоя, которое меняется как единое целое. */
export interface TextContent {
  text: string;
  style: TextStyleConfig;
  boxWidth: number | null;
}

export interface TextChangeEntry extends HistoryEntryBase {
  type: "text-change";
  layerId: EntityId;
  before: TextContent;
  after: TextContent;
}

export interface MaskChangeEntry extends HistoryEntryBase {
  type: "mask-change";
  layerId: EntityId;
  before: LayerMask | null;
  after: LayerMask | null;
}

export interface SelectionChangeEntry extends HistoryEntryBase {
  type: "selection-change";
  before: SelectionState;
  after: SelectionState;
}

export type HistoryEntry =
  | PixelPatchEntry
  | LayerAddEntry
  | LayerRemoveEntry
  | LayerReorderEntry
  | LayerPropsEntry
  | LayerStylesEntry
  | AdjustmentChangeEntry
  | SmartTransformEntry
  | TextChangeEntry
  | MaskChangeEntry
  | SelectionChangeEntry;

/** Состояние стеков Undo/Redo. */
export interface HistoryState {
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  /** Жёсткий лимит суммарного byteSize обоих стеков. */
  memoryLimitBytes: number;
  /** Текущий суммарный byteSize обоих стеков. */
  usedBytes: number;
  /** Максимальное число записей (защита от тысяч мелких записей). */
  maxEntries: number;
}

/** 256 МБ по умолчанию. */
export const DEFAULT_HISTORY_MEMORY_LIMIT_BYTES = 256 * 1024 * 1024;
export const DEFAULT_HISTORY_MAX_ENTRIES = 200;

export function createEmptyHistory(
  memoryLimitBytes: number = DEFAULT_HISTORY_MEMORY_LIMIT_BYTES,
  maxEntries: number = DEFAULT_HISTORY_MAX_ENTRIES,
): HistoryState {
  return {
    undoStack: [],
    redoStack: [],
    memoryLimitBytes,
    usedBytes: 0,
    maxEntries,
  };
}

/* ========================================================================== */
/* 11. РЕНДЕР В WEB WORKER (контракт сообщений)                                */
/* ========================================================================== */

/** Общие поля описания слоя при передаче в воркер. */
interface RenderLayerBase {
  id: EntityId;
  /** Положение и размер области, которую занимает bitmap/pixels, в координатах документа. */
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  opacity: number;
  blendMode: BlendMode;
  /** 8-бит альфа маски (width*height) или null. Передаётся как Transferable. */
  maskBuffer: ArrayBuffer | null;
  /** Эффекты слоя (тень, внутреннее свечение, обводка). */
  styles: LayerStyles;
}

export interface RasterRenderLayer extends RenderLayerBase {
  type: "raster";
  /** RGBA (не premultiplied), длина width*height*4. Transferable. */
  pixels: ArrayBuffer;
}

export interface AdjustmentRenderLayer extends RenderLayerBase {
  type: "adjustment";
  adjustment: AdjustmentParams;
}

/**
 * Смарт-объект. Главный поток декодирует исходник в ImageBitmap максимального
 * качества; воркер рисует его через OffscreenCanvas с матрицей transform.
 * Для SVG bitmap растеризуется под текущий масштаб (bitmapScale = пикселей bitmap на единицу SVG).
 */
export interface SmartObjectRenderLayer extends RenderLayerBase {
  type: "smartObject";
  /** Transferable. */
  bitmap: ImageBitmap;
  bitmapScale: number;
  transform: SmartTransform;
  naturalWidth: number;
  naturalHeight: number;
}

/**
 * Текст. Шрифты живут в document.fonts главного потока, поэтому текст
 * растеризуется там в ImageBitmap (размер width*height) и передаётся воркеру готовым.
 */
export interface TextRenderLayer extends RenderLayerBase {
  type: "text";
  /** Transferable. */
  bitmap: ImageBitmap;
}

export type RenderLayer =
  | RasterRenderLayer
  | AdjustmentRenderLayer
  | SmartObjectRenderLayer
  | TextRenderLayer;

/** Запрос кадра: main → worker. */
export interface RenderRequest {
  type: "render";
  /** Монотонно растущий номер кадра. */
  frameId: number;
  /** Размер итогового холста. */
  width: number;
  height: number;
  /** Слои снизу вверх (первый — самый нижний). */
  layers: RenderLayer[];
}

/** Успешный ответ: worker → main. */
export interface RenderResponse {
  type: "rendered";
  frameId: number;
  width: number;
  height: number;
  /** Итоговый RGBA-буфер. Transferable (Zero-Copy). */
  pixels: ArrayBuffer;
  /** Время склейки в мс (для профилирования). */
  durationMs: number;
}

export interface RenderErrorResponse {
  type: "error";
  frameId: number;
  message: string;
}

export type WorkerInboundMessage = RenderRequest;
export type WorkerOutboundMessage = RenderResponse | RenderErrorResponse;

/**
 * Состояние очереди кадров в Renderer.ts: пока воркер занят, хранится
 * только ПОСЛЕДНИЙ запрос (промежуточные кадры отбрасываются).
 */
export interface FrameQueueState {
  busy: boolean;
  pending: RenderRequest | null;
  lastCompletedFrameId: number;
}

/* ========================================================================== */
/* 12. МАКРОСЫ (Actions) И ПАКЕТНАЯ ОБРАБОТКА                                  */
/* ========================================================================== */

export interface BrightnessContrastStep {
  type: "brightnessContrast";
  brightness: number;
  contrast: number;
}

export interface ColorBalanceStep {
  type: "colorBalance";
  shadows: ColorShift;
  midtones: ColorShift;
  highlights: ColorShift;
  preserveLuminosity: boolean;
}

export interface InvertStep {
  type: "invert";
}

export interface GaussianBlurStep {
  type: "gaussianBlur";
  /** Радиус размытия в пикселях, > 0. */
  radius: number;
}

/** Кривые на бэкенде применяются через LUT (256 значений на канал) с SIMD. */
export interface CurvesStep {
  type: "curves";
  channels: Record<ToneChannel, CurvePoint[]>;
}

/** Уровни на бэкенде сводятся к LUT и применяются через SIMD. */
export interface LevelsStep {
  type: "levels";
  channels: Record<ToneChannel, LevelsChannel>;
}

export type MacroStep =
  | BrightnessContrastStep
  | ColorBalanceStep
  | InvertStep
  | GaussianBlurStep
  | CurvesStep
  | LevelsStep;

export type MacroStepType = MacroStep["type"];

/** Записанный макрос. Совпадает по форме с JSON-контрактом бэкенда. */
export interface Macro {
  id: EntityId;
  name: string;
  /** Версия схемы JSON для обратной совместимости. */
  schemaVersion: 1;
  createdAt: string;
  steps: MacroStep[];
}

export type BatchOutputFormat = "png" | "jpeg" | "webp";

/** Запрос пакетной обработки папки: frontend → backend. */
export interface BatchProcessRequest {
  macro: Macro;
  /** Путь к папке с исходными изображениями на стороне сервера. */
  inputFolder: string;
  outputFolder: string;
  outputFormat: BatchOutputFormat;
  /** Качество 1..100 (для jpeg/webp). */
  quality: number;
}

export interface BatchFileResult {
  fileName: string;
  success: boolean;
  error: string | null;
  durationMs: number;
}

export interface BatchProcessResponse {
  total: number;
  succeeded: number;
  failed: number;
  results: BatchFileResult[];
}

/** Состояние записи макроса на фронтенде. */
export interface MacroRecorderState {
  isRecording: boolean;
  current: Macro | null;
  saved: Macro[];
}

/* ========================================================================== */
/* 13. ГЛОБАЛЬНОЕ СОСТОЯНИЕ ДОКУМЕНТА                                          */
/* ========================================================================== */

/** Полное состояние редактора, хранимое в React (иммутабельно обновляется). */
export interface EditorState {
  /** Размер документа в пикселях. */
  documentWidth: number;
  documentHeight: number;
  /** Слои снизу вверх. */
  layers: Layer[];
  activeLayerId: EntityId | null;
  selection: SelectionState;
  config: EditorConfig;
  history: HistoryState;
  macros: MacroRecorderState;
}

/* ========================================================================== */
/* 14. ЗНАЧЕНИЯ ПО УМОЛЧАНИЮ И ФАБРИКИ                                         */
/* ========================================================================== */

export const DEFAULT_BRUSH_CONFIG: BrushConfig = {
  size: 20,
  hardness: 0.8,
  opacity: 1,
  flow: 1,
  spacing: 0.1,
  color: { r: 0, g: 0, b: 0, a: 1 },
};

export const DEFAULT_ERASER_CONFIG: EraserConfig = {
  size: 20,
  hardness: 0.8,
  opacity: 1,
  spacing: 0.1,
};

export const DEFAULT_GRADIENT_CONFIG: GradientConfig = {
  type: "linear",
  stops: [
    { id: "stop-start", position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
    { id: "stop-end", position: 1, color: { r: 255, g: 255, b: 255, a: 1 } },
  ],
  opacity: 1,
  reverse: false,
  blendMode: BlendMode.Normal,
};

export const DEFAULT_TEXT_STYLE: TextStyleConfig = {
  fontFamily: "Segoe UI, Arial, sans-serif",
  fontSize: 32,
  fontWeight: 400,
  italic: false,
  tracking: 0,
  lineHeight: 1.2,
  align: "left",
  color: { r: 0, g: 0, b: 0, a: 1 },
};

export const DEFAULT_TOOL_SETTINGS: ToolSettings = {
  move: { autoSelectLayer: false },
  marquee: { feather: 0, antiAlias: true },
  magicWand: {
    tolerance: 32,
    contiguous: true,
    sampleAllLayers: false,
    antiAlias: true,
    combine: "replace",
  },
  brush: DEFAULT_BRUSH_CONFIG,
  eraser: DEFAULT_ERASER_CONFIG,
  pen: { combine: "add", snapRadius: 8, showHandles: true },
  gradient: DEFAULT_GRADIENT_CONFIG,
  fill: {
    tolerance: 32,
    contiguous: true,
    sampleAllLayers: false,
    antiAlias: true,
    color: { r: 0, g: 0, b: 0, a: 1 },
  },
  text: { style: DEFAULT_TEXT_STYLE, wrapInBox: false },
  eyedropper: { sampleRadius: 0, sampleAllLayers: true },
};

export const DEFAULT_EDITOR_CONFIG: EditorConfig = {
  scale: 1,
  panX: 0,
  panY: 0,
  activeToolId: "brush",
  tools: DEFAULT_TOOL_SETTINGS,
};

/** Эффекты слоя по умолчанию: все выключены, значения — разумные стартовые. */
export function createDefaultLayerStyles(): LayerStyles {
  return {
    dropShadow: {
      enabled: false,
      color: { r: 0, g: 0, b: 0, a: 1 },
      opacity: 0.75,
      angle: 120,
      distance: 5,
      size: 5,
      spread: 0,
      blendMode: BlendMode.Multiply,
    },
    innerGlow: {
      enabled: false,
      color: { r: 255, g: 255, b: 190, a: 1 },
      opacity: 0.75,
      source: "edge",
      size: 5,
      choke: 0,
      blendMode: BlendMode.Screen,
    },
    stroke: {
      enabled: false,
      color: { r: 255, g: 0, b: 0, a: 1 },
      opacity: 1,
      width: 3,
      position: "outside",
      blendMode: BlendMode.Normal,
    },
  };
}

/** Трансформация нового смарт-объекта: исходный размер по центру документа. */
export function createDefaultSmartTransform(
  documentWidth: number,
  documentHeight: number,
): SmartTransform {
  return {
    centerX: documentWidth / 2,
    centerY: documentHeight / 2,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
  };
}

/** Тождественная кривая: две точки (0,0) и (255,255). */
export function createIdentityCurve(): CurvePoint[] {
  return [
    { x: 0, y: 0 },
    { x: 255, y: 255 },
  ];
}

/** Тождественные уровни. */
export function createIdentityLevels(): LevelsChannel {
  return { inputBlack: 0, inputWhite: 255, gamma: 1, outputBlack: 0, outputWhite: 255 };
}

/** Дефолтные параметры для нового корректирующего слоя. */
export function createDefaultAdjustment(kind: AdjustmentKind): AdjustmentParams {
  switch (kind) {
    case "brightnessContrast":
      return { kind, brightness: 0, contrast: 0 };
    case "colorBalance": {
      const zero: ColorShift = { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 };
      return {
        kind,
        shadows: { ...zero },
        midtones: { ...zero },
        highlights: { ...zero },
        preserveLuminosity: true,
      };
    }
    case "invert":
      return { kind };
    case "curves":
      return {
        kind,
        channels: {
          rgb: createIdentityCurve(),
          red: createIdentityCurve(),
          green: createIdentityCurve(),
          blue: createIdentityCurve(),
        },
      };
    case "levels":
      return {
        kind,
        channels: {
          rgb: createIdentityLevels(),
          red: createIdentityLevels(),
          green: createIdentityLevels(),
          blue: createIdentityLevels(),
        },
      };
  }
}