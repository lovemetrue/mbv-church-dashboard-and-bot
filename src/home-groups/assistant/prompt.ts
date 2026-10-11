import { AGENTS } from '../../platform/settings/defaults.js';
import type { PromptsRepo } from '../../db/repos/prompts.repo.js';
import type { RawBrief } from './brief.js';
import { scrub } from './brief.js';

/** Какие блоки инструкции собираются в запрос и в каком порядке. «Служебное» всегда берётся из кода. */
const ORDER = ['role', 'principles', 'steps', 'examples', 'service'] as const;
const HEADINGS: Record<(typeof ORDER)[number], string> = {
  role: 'РОЛЬ', principles: 'ПРИНЦИПЫ', steps: 'ШАГИ', examples: 'ПРИМЕРЫ', service: 'ФОРМАТ И ГРАНИЦЫ',
};

/** Инструкция помощнику: действующие версии блоков из «Настроек», а где их не правили — текст по умолчанию из кода. */
export async function buildSystemPrompt(prompts: Pick<PromptsRepo, 'all'>): Promise<string> {
  const agent = AGENTS.find((a) => a.key === 'coordinator')!;
  const rows = (await prompts.all()).filter((r) => r.agent_key === agent.key && r.active);
  const parts: string[] = [];
  for (const key of ORDER) {
    const block = agent.blocks.find((b) => b.key === key);
    if (!block) continue;
    const text = block.editable ? (rows.find((r) => r.block_key === key)?.text ?? block.text) : block.text;
    if (text.trim() === '') continue;
    parts.push(`### ${HEADINGS[key]}\n${text.trim()}`);
  }
  return parts.join('\n\n');
}

/**
 * Записи для модели: номер-ссылка вместо номера заявки в базе, и только очищенные от контактов тексты.
 * Больше у модели ничего нет — ни имён, ни телефонов, ни адресов, ни данных групп.
 */
export function buildUserMessage(
  items: readonly { ref: string; brief: RawBrief }[],
  lists: { districts: readonly string[]; ages: readonly string[] },
): string {
  return JSON.stringify({
    districts: lists.districts,
    ages: lists.ages,
    items: items.map(({ ref, brief }) => ({
      ref,
      place: scrub(brief.place),
      age: scrub(brief.age),
      schedule: scrub(brief.schedule),
    })),
  });
}
