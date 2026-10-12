import { describe, expect, test } from 'vitest';
import { PROVIDERS, PROVIDER_IDS, validateBaseUrl } from '../src/platform/llm/providers.js';

describe('провайдеры языковой модели', () => {
  test('у каждого готового провайдера есть адрес, модель по умолчанию и она есть в списке', () => {
    for (const id of PROVIDER_IDS.filter((p) => p !== 'custom')) {
      const p = PROVIDERS[id];
      expect(p.baseUrl, id).toMatch(/^https:\/\//);
      expect(p.models, id).toContain(p.defaultModel);
    }
  });

  test('у «другого» провайдера адреса нет, его вводит человек', () => {
    expect(PROVIDERS.custom.baseUrl).toBeNull();
    expect(PROVIDERS.custom.defaultModel).toBeNull();
  });
});

describe('адрес «другого» провайдера', () => {
  test('нормальный https-адрес принимается, лишние слэши в конце убираются', () => {
    expect(validateBaseUrl('https://llm.example.org/v1/')).toEqual({ ok: true, url: 'https://llm.example.org/v1' });
    expect(validateBaseUrl('  https://api.example.com  ')).toEqual({ ok: true, url: 'https://api.example.com' });
  });

  test.each([
    ['', 'пусто'], ['llm.example.org', 'без схемы'], ['http://llm.example.org', 'не https'], ['ftp://x.org', 'чужая схема'],
    ['https://user:pass@llm.example.org', 'логин в адресе'], ['https://localhost/v1', 'localhost'], ['https://127.0.0.1/v1', 'loopback'],
    ['https://10.0.0.5/v1', 'частная сеть'], ['https://192.168.1.1', 'частная сеть'], ['https://172.20.0.1', 'частная сеть'],
    ['https://169.254.169.254/latest', 'метаданные облака'], ['https://[::1]/v1', 'loopback v6'], ['https://db/v1', 'имя без точки: внутри docker-сети'],
    ['https://x.org/' + 'a'.repeat(300), 'слишком длинный'],
  ])('адрес %j отклоняется (%s)', (url) => {
    expect(validateBaseUrl(url).ok).toBe(false);
  });

  test('отказ объясняется по-русски', () => {
    const r = validateBaseUrl('http://x.org');
    expect(r.ok ? '' : r.message).toMatch(/https/);
  });
});
