/**
 * GlazePhoto — контракт инструментов.
 * Файл: frontend/src/tools/Tool.ts
 *
 * Инструменты не знают о React: они получают события указателя в нейтральной
 * форме (ToolPointerEvent) и работают с редактором только через ToolContext.
 */

import type {
  EditorConfig,
  HistoryEntry,
  Layer,
  SelectionState,
  ToolId,
} from "../core/types";

/** Левый верхний угол области просмотра в координатах окна. */
export interface ViewportOrigin {
  left: number;
  top: number;
}

/** Одна точка движения указателя в координатах окна. */
export interface ToolPointerSample {
  clientX: number;
  clientY: number;
  pressure: number;
}

/** Событие указателя для инструмента. */
export interface ToolPointerEvent extends ToolPointerSample {
  pointerId: number;
  pointerType: string;
  /** 0 — основная кнопка (левая / касание / перо). */
  button: number;
  /**
   * Промежуточные точки, которые браузер «склеил» в одно событие pointermove.
   * Именно они дают плавные линии при быстром движении (мышь 1000 Гц, перо).
   * Пусто для pointerdown/pointerup.
   */
  coalesced: readonly ToolPointerSample[];
}

/**
 * Преобразует нативный PointerEvent в ToolPointerEvent.
 * Вызывать СИНХРОННО внутри обработчика события (getCoalescedEvents
 * после выхода из обработчика возвращает пустой список).
 * Для React: toToolPointerEvent(e.nativeEvent).
 */
export function toToolPointerEvent(event: PointerEvent): ToolPointerEvent {
  const rawCoalesced: PointerEvent[] =
    typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [];
  const coalesced: ToolPointerSample[] = rawCoalesced.map((item) => ({
    clientX: item.clientX,
    clientY: item.clientY,
    pressure: item.pressure,
  }));
  return {
    clientX: event.clientX,
    clientY: event.clientY,
    pressure: event.pressure,
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    button: event.button,
    coalesced,
  };
}

/** Всё, что инструменту нужно от редактора. Реализуется в EditorUI/слое состояния. */
export interface ToolContext {
  /** Актуальная конфигурация (масштаб, сдвиг, настройки инструментов). */
  getEditorConfig(): EditorConfig;
  /**
   * Левый верхний угол контейнера просмотра: getBoundingClientRect() элемента,
   * внутри которого холст сдвигается через translate(panX, panY) scale(scale)
   * с transform-origin: 0 0.
   */
  getViewportRect(): ViewportOrigin;
  /** Активный слой или null. */
  getActiveLayer(): Layer | null;
  /** Текущее выделение (координаты документа). */
  getSelection(): SelectionState;
  /** Попросить рендерер собрать новый кадр (пиксели слоя изменились). */
  requestRender(): void;
  /** Записать действие в историю Undo/Redo. */
  pushHistory(entry: HistoryEntry): void;
}

/** Интерфейс любого инструмента. */
export interface Tool {
  readonly id: ToolId;
  onPointerDown(event: ToolPointerEvent): void;
  onPointerMove(event: ToolPointerEvent): void;
  onPointerUp(event: ToolPointerEvent): void;
  /** Системная отмена жеста (pointercancel, потеря фокуса, смена инструмента). */
  onPointerCancel(): void;
  /** Освободить ресурсы (вызывается при смене инструмента и размонтировании). */
  dispose(): void;
}