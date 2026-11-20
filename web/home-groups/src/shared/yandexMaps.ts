/**
 * Загрузка Яндекс.Карт (JS API 2.1) по требованию. Скрипт тянется с серверов Яндекса только по кнопке карты («Показать
 * карту» или «Обновить»): каждая загрузка расходует суточный лимит ключа. Дальше, до перезагрузки страницы, скрипт уже
 * на месте, и карта на других вкладках интерфейса открывается без нового расхода.
 *
 * Описан лишь тот кусок API, который нужен карте групп; больше не нужно, и типов Яндекса в проекте нет.
 */
export interface YPlacemark { events: { add(type: string, handler: () => void): void } }
export interface YMap {
  geoObjects: { add(o: YPlacemark): void; remove(o: YPlacemark): void };
  setBounds(bounds: [[number, number], [number, number]], opts?: { checkZoomRange?: boolean; zoomMargin?: number }): void;
  getCenter(): [number, number];
  getZoom(): number;
  /** Нужен лишь `boundschange`: человек сдвинул карту или сменил масштаб. */
  events: { add(type: string, handler: () => void): void };
  destroy(): void;
}
export interface YMaps {
  Map: new (el: HTMLElement, state: { center: [number, number]; zoom: number; controls?: string[] }, options?: Record<string, unknown>) => YMap;
  Placemark: new (coords: [number, number], props: Record<string, unknown>, options?: Record<string, unknown>) => YPlacemark;
  ready(cb: () => void): void;
}

declare global {
  interface Window { ymaps?: YMaps }
}

let loading: Promise<YMaps> | null = null;
let loadedKey: string | null = null;

export function loadYandexMaps(apiKey: string): Promise<YMaps> {
  // Один скрипт на страницу: повторный вызов с тем же ключом получает ту же загрузку и не тратит лимит ещё раз.
  if (loading && loadedKey === apiKey) return loading;
  loadedKey = apiKey;
  loading = new Promise<YMaps>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://api-maps.yandex.ru/2.1/?apikey=${encodeURIComponent(apiKey)}&lang=ru_RU`;
    script.async = true;
    script.onload = () => {
      const y = window.ymaps;
      if (!y) { reject(new Error('ymaps не появился')); return; }
      y.ready(() => resolve(y));
    };
    script.onerror = () => reject(new Error('скрипт карты не загрузился'));
    document.head.append(script);
  }).catch((e) => {
    // Неудачу не запоминаем: следующая попытка должна пойти заново.
    loading = null;
    throw e;
  });
  return loading;
}
