import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { resetDemoChat } from '../fixtures/chat';

afterEach(() => {
  cleanup();
  // Демо-разговор помощника хранится в модуле: без сброса вопрос одного теста попал бы в историю следующего.
  resetDemoChat();
  try {
    window.localStorage.clear();
  } catch {
    /* в jsdom хранилище есть, но не падаем, если его нет */
  }
});
