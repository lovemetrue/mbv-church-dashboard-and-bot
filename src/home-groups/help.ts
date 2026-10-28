import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { HelpArticleView, HelpIndexView } from './contracts.js';

/**
 * База знаний: инструкции для служителей, которые открываются знаком «?» в шапке и которые читает помощник, когда вопрос
 * не про данные, а про работу интерфейса. Источник — те же Markdown-файлы, что лежат в репозитории (правят их там же),
 * в образе они собраны в один каталог (`/app/help`, см. Dockerfile). Новую статью добавляют в `HELP_ARTICLES`.
 */
export const HELP_ARTICLES: readonly { id: string; title: string; file: string }[] = [
  { id: 'faq', title: 'Частые проблемы', file: 'ЧАСТЫЕ-ВОПРОСЫ.md' },
  { id: 'guide', title: 'Как работает интерфейс', file: 'КАК-РАБОТАЕТ-ДАШБОРД.md' },
  { id: 'team', title: 'Памятка для команды', file: 'ИНСТРУКЦИЯ-КООРДИНАТОРА.md' },
];

/** Картинки к статьям — только по имени файла из папки инструкции: путь из адреса наружу каталога не выйдет. */
const IMAGE = /^[\w.-]+\.png$/;
const IMAGE_DIR = 'инструкция-координатора';

export interface HelpSection {
  article: string;
  /** Заголовок раздела с заголовком статьи: «Частые проблемы → Нет кнопки «Изменить»». */
  title: string;
  text: string;
}

/** Основа слова: русские окончания отрезаем грубо — «заявку», «заявки», «заявка» сводятся к «заяв». */
const stem = (w: string): string => (w.length > 5 ? w.slice(0, Math.max(4, w.length - 3)) : w);
/** Слова, которые есть в каждом втором вопросе: они не отличают один раздел от другого. */
const STOP = new Set(['что', 'как', 'для', 'это', 'или', 'при', 'его', 'она', 'они', 'мне', 'мой', 'меня', 'наш', 'все', 'вот', 'так', 'там', 'есть', 'почему', 'можно', 'могу', 'надо', 'нужно', 'где', 'когда', 'кто']);
const words = (s: string): string[] =>
  (s.toLowerCase().replace(/ё/g, 'е').match(/[a-zа-я0-9]{3,}/g) ?? []).filter((w) => !STOP.has(w)).map(stem);

/** Разделы статьи по заголовкам второго и третьего уровня: помощнику отдаём раздел, а не всю статью. */
export function splitSections(article: string, markdown: string): HelpSection[] {
  const out: HelpSection[] = [];
  let title = article;
  let parent = '';
  let buf: string[] = [];
  const flush = () => {
    const text = buf.join('\n').trim();
    if (text) out.push({ article, title, text });
    buf = [];
  };
  for (const line of markdown.split('\n')) {
    const h = /^(#{2,3})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      if (h[1] === '##') parent = h[2]!.trim();
      title = h[1] === '##' ? `${article} → ${parent}` : `${article} → ${parent} → ${h[2]!.trim()}`;
      continue;
    }
    buf.push(line);
  }
  flush();
  return out;
}

/**
 * Поиск по разделам: сколько основ слов вопроса нашлось в разделе, совпадение в заголовке весит втрое. Модель получает
 * несколько лучших разделов и отвечает по ним; точности поисковика тут не нужно — разделов немного и они короткие.
 */
export function searchSections(sections: readonly HelpSection[], query: string, limit = 4): HelpSection[] {
  const q = [...new Set(words(query))];
  if (q.length === 0) return [];
  const scored = sections.map((s) => {
    const head = new Set(words(s.title));
    const body = new Set(words(s.text));
    const score = q.reduce((n, w) => n + (head.has(w) ? 3 : 0) + (body.has(w) ? 1 : 0), 0);
    return { s, score };
  });
  return scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.s);
}

export function createHelp(deps: { dirs: readonly string[] }) {
  async function firstFile(name: string, sub = ''): Promise<Buffer | null> {
    for (const dir of deps.dirs) {
      const found = await readFile(join(dir, sub, name)).catch(() => null);
      if (found) return found;
    }
    return null;
  }
  const read = async (file: string): Promise<string | null> => (await firstFile(file))?.toString('utf8') ?? null;

  async function sections(): Promise<HelpSection[]> {
    const all: HelpSection[] = [];
    for (const a of HELP_ARTICLES) {
      const md = await read(a.file);
      if (md) all.push(...splitSections(a.title, md));
    }
    return all;
  }

  return {
    /** Статьи, которые нашлись на диске: без файла статьи нет и в списке. */
    async index(): Promise<HelpIndexView> {
      const found = await Promise.all(HELP_ARTICLES.map(async (a) => ((await read(a.file)) !== null ? { id: a.id, title: a.title } : null)));
      return { articles: found.filter((a): a is { id: string; title: string } => a !== null) };
    },
    async article(id: string): Promise<HelpArticleView | null> {
      const a = HELP_ARTICLES.find((x) => x.id === id);
      const markdown = a ? await read(a.file) : null;
      return a && markdown !== null ? { id: a.id, title: a.title, markdown } : null;
    },
    async image(name: string): Promise<Buffer | null> {
      return IMAGE.test(name) ? firstFile(name, IMAGE_DIR) : null;
    },
    /** Разделы базы знаний под вопрос — для помощника. */
    async search(query: string, limit?: number): Promise<HelpSection[]> {
      return searchSections(await sections(), query, limit);
    },
  };
}

export type Help = ReturnType<typeof createHelp>;
