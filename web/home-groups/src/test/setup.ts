import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { resetDemoChat } from '../fixtures/chat';
import { resetDemoGender } from '../fixtures/gender';
import { resetMapSession } from '../features/reference/mapSession';

afterEach(() => {
  // Память карты групп живёт в модуле до перезагрузки страницы: каждый тест начинает как после F5.
  resetMapSession();
  cleanup();
  // Демо-разговор помощника хранится в модуле: без сброса вопрос одного теста попал бы в историю следующего.
  resetDemoChat();
  resetDemoGender();
  try {
    window.localStorage.clear();
  } catch {
    /* в jsdom хранилище есть, но не падаем, если его нет */
  }
});
