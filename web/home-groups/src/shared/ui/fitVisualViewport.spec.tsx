import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { Drawer } from './Drawer';
import { Modal } from './Modal';

/**
 * Телефон с увеличенной страницей (щипком или самим браузером): видимая часть — `visualViewport` — меньше и сдвинута
 * относительно области, к которой привязано `position: fixed`. Карточка и окно должны занимать именно видимую часть,
 * иначе они уезжают за край экрана и обрезаются.
 */
class FakeViewport extends EventTarget {
  constructor(public width: number, public height: number, public offsetLeft: number, public offsetTop: number) {
    super();
  }
}

function phone(narrow: boolean, vv: FakeViewport) {
  vi.stubGlobal('visualViewport', vv);
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: narrow,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

afterEach(() => vi.unstubAllGlobals());

const box = (el: HTMLElement) => ({ left: el.style.left, top: el.style.top, width: el.style.width, height: el.style.height });

describe('карточка и окно на увеличенной странице телефона', () => {
  test('карточка занимает видимую часть экрана и следует за ней при прокрутке и смене масштаба', () => {
    const vv = new FakeViewport(316, 700, 78, 40);
    phone(true, vv);
    render(
      <Drawer label="Карточка группы" title="Группа" onClose={() => undefined}>
        текст
      </Drawer>,
    );
    const card = screen.getByRole('dialog', { name: 'Карточка группы' });
    expect(box(card)).toEqual({ left: '78px', top: '40px', width: '316px', height: '700px' });
    act(() => {
      Object.assign(vv, { width: 412, height: 800, offsetLeft: 0, offsetTop: 0 });
      vv.dispatchEvent(new Event('resize'));
    });
    expect(box(card)).toEqual({ left: '0px', top: '0px', width: '412px', height: '800px' });
  });

  test('на планшете карточка шире 440 не бывает и стоит у правого края видимой части', () => {
    phone(true, new FakeViewport(800, 900, 30, 0));
    render(
      <Drawer label="Карточка группы" title="Группа" onClose={() => undefined}>
        текст
      </Drawer>,
    );
    expect(box(screen.getByRole('dialog', { name: 'Карточка группы' }))).toEqual({ left: '390px', top: '0px', width: '440px', height: '900px' });
  });

  test('окно правки тоже укладывается в видимую часть: затемнение под ним — ровно по экрану', () => {
    phone(true, new FakeViewport(316, 700, 78, 40));
    render(
      <Modal title="Правка группы" onClose={() => undefined}>
        поля
      </Modal>,
    );
    const scrim = screen.getByRole('dialog', { name: 'Правка группы' }).parentElement!;
    expect(box(scrim)).toEqual({ left: '78px', top: '40px', width: '316px', height: '700px' });
  });

  test('на широком экране расположение остаётся за стилями: карточка справа, окно по центру', () => {
    phone(false, new FakeViewport(316, 700, 78, 40));
    render(
      <Drawer label="Карточка группы" title="Группа" onClose={() => undefined}>
        текст
      </Drawer>,
    );
    expect(box(screen.getByRole('dialog', { name: 'Карточка группы' }))).toEqual({ left: '', top: '', width: '', height: '' });
  });
});
