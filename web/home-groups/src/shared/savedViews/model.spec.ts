import { describe, expect, test } from 'vitest';
import {
  VIEWS_PER_SCOPE_MAX,
  VIEW_NAME_MAX,
  addView,
  parseStoredViews,
  pickViewParams,
  removeView,
  viewPatch,
  viewsOf,
  type StoredView,
} from './model';
import { patchParams } from '../nav';

const sp = (s: string) => new URLSearchParams(s);

describe('«Мои виды»: что попадает в сохранённый вид', () => {
  test('вид «Заявок» хранит корзину и «в работе у», а вкладку и открытую заявку нет', () => {
    const q = pickViewParams('requests', sp('tab=requests&bucket=ready&resp=Анна&req=12'), { withSearch: false });
    expect(sp(q).get('bucket')).toBe('ready');
    expect(sp(q).get('resp')).toBe('Анна');
    expect(sp(q).has('tab')).toBe(false);
    expect(sp(q).has('req')).toBe(false);
  });

  test('поиск по заявкам сохраняется только по явной отметке', () => {
    const params = sp('tab=requests&bucket=ready&q=Соколова');
    expect(sp(pickViewParams('requests', params, { withSearch: false })).has('q')).toBe(false);
    expect(sp(pickViewParams('requests', params, { withSearch: true })).get('q')).toBe('Соколова');
  });

  test('вид «Справочника» хранит сущность, отборы, столбцы, группировку и сортировку, но не открытую запись и быстрый поиск', () => {
    const q = sp(
      pickViewParams(
        'reference',
        sp('tab=reference&ent=people&f=Район:eq:Невский&f=Статус:ne:Закрыта&col=№&col=Район&gb=Район&sort=Район:asc&nodef=1&rec=u7&rq=Иванов'),
        { withSearch: true },
      ),
    );
    expect(q.get('ent')).toBe('people');
    expect(q.getAll('f')).toEqual(['Район:eq:Невский', 'Статус:ne:Закрыта']);
    expect(q.getAll('col')).toEqual(['№', 'Район']);
    expect(q.get('gb')).toBe('Район');
    expect(q.get('sort')).toBe('Район:asc');
    // «отбор по умолчанию снят» — часть отбора: без метки вид с пустым отбором вернул бы умолчание
    expect(q.get('nodef')).toBe('1');
    for (const k of ['tab', 'rec', 'rq']) expect(q.has(k)).toBe(false);
  });
});

describe('«Мои виды»: применение вида', () => {
  test('вид заменяет параметры экрана: старые отборы уходят, вкладка остаётся, открытая заявка закрывается', () => {
    const current = sp('tab=requests&bucket=human&resp=Борис&q=старый&req=5');
    const next = patchParams(current, viewPatch('requests', 'bucket=ready'));
    expect(next.get('tab')).toBe('requests');
    expect(next.get('bucket')).toBe('ready');
    expect(next.has('resp')).toBe(false);
    expect(next.has('q')).toBe(false);
    expect(next.has('req')).toBe(false);
  });

  test('повторяющиеся параметры справочника записываются все, а быстрый поиск и открытая запись сбрасываются', () => {
    const current = sp('tab=reference&f=Район:eq:Старый&rec=3&rq=текст');
    const next = patchParams(current, viewPatch('reference', 'ent=groups&f=Район:eq:Невский&f=Статус:eq:Закрыта&gb=Район'));
    expect(next.getAll('f')).toEqual(['Район:eq:Невский', 'Статус:eq:Закрыта']);
    expect(next.get('gb')).toBe('Район');
    expect(next.has('rec')).toBe(false);
    expect(next.has('rq')).toBe(false);
  });

  test('чужие параметры в записи хранилища (вкладка, заявка) вид не применяет', () => {
    const next = patchParams(sp('tab=requests'), viewPatch('requests', 'bucket=done&tab=settings&req=9&rec=1'));
    expect(next.get('tab')).toBe('requests');
    expect(next.has('req')).toBe(false);
    expect(next.has('rec')).toBe(false);
    expect(next.get('bucket')).toBe('done');
  });
});

describe('«Мои виды»: список', () => {
  test('вид добавляется под именем без лишних пробелов, виды экранов не смешиваются', () => {
    const r1 = addView([], 'requests', '  Мои   звонки ', 'bucket=queue');
    expect(r1.error).toBeUndefined();
    const r2 = addView(r1.views, 'reference', 'Мои звонки', 'ent=people');
    expect(viewsOf(r2.views, 'requests').map((v) => v.name)).toEqual(['Мои звонки']);
    expect(viewsOf(r2.views, 'reference').map((v) => v.name)).toEqual(['Мои звонки']);
  });

  test('пустое имя и имя длиннее сорока знаков не принимаются', () => {
    expect(addView([], 'requests', '   ', 'bucket=queue').error).toBe('empty');
    expect(addView([], 'requests', 'я'.repeat(VIEW_NAME_MAX + 1), 'bucket=queue').error).toBe('long');
    expect(addView([], 'requests', 'я'.repeat(VIEW_NAME_MAX), 'bucket=queue').error).toBeUndefined();
  });

  test('вид с тем же именем (без учёта регистра) обновляется, а не дублируется', () => {
    const a = addView([], 'requests', 'Звонки', 'bucket=queue');
    const b = addView(a.views, 'requests', 'звонки', 'bucket=ready');
    expect(viewsOf(b.views, 'requests')).toEqual([{ scope: 'requests', name: 'звонки', query: 'bucket=ready' }]);
  });

  test('больше двадцати видов на экран не сохраняется, но существующий можно перезаписать', () => {
    let views: StoredView[] = [];
    for (let i = 0; i < VIEWS_PER_SCOPE_MAX; i++) views = addView(views, 'requests', `вид ${i}`, 'bucket=ready').views;
    const over = addView(views, 'requests', 'лишний', 'bucket=ready');
    expect(over.error).toBe('limit');
    expect(over.views).toHaveLength(VIEWS_PER_SCOPE_MAX);
    expect(addView(views, 'requests', 'вид 3', 'bucket=done').error).toBeUndefined();
    // лимит у каждого экрана свой
    expect(addView(views, 'reference', 'другой экран', 'ent=people').error).toBeUndefined();
  });

  test('удаление убирает только вид своего экрана', () => {
    const a = addView(addView([], 'requests', 'А', 'bucket=ready').views, 'reference', 'А', 'ent=people').views;
    const after = removeView(a, 'requests', 'А');
    expect(viewsOf(after, 'requests')).toEqual([]);
    expect(viewsOf(after, 'reference')).toHaveLength(1);
  });
});

describe('«Мои виды»: чтение из хранилища', () => {
  test('мусор и битый JSON дают пустой список, а не падение', () => {
    expect(parseStoredViews(null)).toEqual([]);
    expect(parseStoredViews('{не json')).toEqual([]);
    expect(parseStoredViews('{"a":1}')).toEqual([]);
  });

  test('записи неверной формы отбрасываются, верные остаются', () => {
    const raw = JSON.stringify([
      { scope: 'requests', name: 'Ок', query: 'bucket=ready' },
      { scope: 'requests', name: '', query: 'bucket=ready' },
      { scope: 'nowhere', name: 'Чужой экран', query: '' },
      { scope: 'requests', name: 'Без запроса' },
      { scope: 'reference', name: 'я'.repeat(VIEW_NAME_MAX + 1), query: '' },
      null,
    ]);
    expect(parseStoredViews(raw)).toEqual([{ scope: 'requests', name: 'Ок', query: 'bucket=ready' }]);
  });
});
