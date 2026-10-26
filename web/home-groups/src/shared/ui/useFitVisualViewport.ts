import { useLayoutEffect, type RefObject } from 'react';

/** Тот же порог, что у карточки в стилях (`Drawer.module.css`): уже него карточка и окна идут на весь экран. */
const NARROW = '(max-width: 1000px)';

const PROPS = ['left', 'top', 'width', 'height', 'right', 'bottom'] as const;

/**
 * Прижимает элемент с `position: fixed` к видимой части экрана (`visualViewport`), а не к области, от которой
 * считается `fixed`.
 *
 * На телефоне они расходятся, когда страница увеличена — щипком или самим браузером (Chrome так делает, например,
 * после касания поля с мелким шрифтом). Тогда карточка, привязанная `right: 0`, уезжала вправо за край экрана и была
 * видна узкой полоской (на этом и споткнулись). Поэтому на узком экране размеры и место берём из `visualViewport` и
 * обновляем при прокрутке и смене масштаба. `maxWidth` — карточка шире не бывает и прижата к правому краю, как в стилях.
 * На широком экране и там, где `visualViewport` нет, расположение остаётся за стилями.
 */
export function useFitVisualViewport(ref: RefObject<HTMLElement | null>, maxWidth?: number): void {
  useLayoutEffect(() => {
    const el = ref.current;
    const vv = window.visualViewport;
    if (!el || !vv || typeof window.matchMedia !== 'function') return;
    const narrow = window.matchMedia(NARROW);

    const clear = () => {
      for (const p of PROPS) el.style.removeProperty(p);
    };
    const apply = () => {
      if (!narrow.matches) {
        clear();
        return;
      }
      const width = maxWidth ? Math.min(maxWidth, vv.width) : vv.width;
      el.style.left = `${vv.offsetLeft + vv.width - width}px`;
      el.style.top = `${vv.offsetTop}px`;
      el.style.width = `${width}px`;
      el.style.height = `${vv.height}px`;
      el.style.right = 'auto';
      el.style.bottom = 'auto';
    };

    apply();
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    narrow.addEventListener?.('change', apply);
    return () => {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
      narrow.removeEventListener?.('change', apply);
      clear();
    };
  }, [ref, maxWidth]);
}
