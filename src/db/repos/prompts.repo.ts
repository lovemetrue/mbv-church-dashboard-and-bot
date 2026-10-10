import type { Pool } from 'pg';

export interface PromptRow {
  agent_key: string;
  block_key: string;
  version: number;
  text: string;
  note: string | null;
  created_by: string;
  created_at: Date;
  active: boolean;
}

/** Версии инструкций агентов. Версии не удаляются и не правятся: правка — это новая версия, откат — смена действующей. */
export class PromptsRepo {
  constructor(private readonly db: Pool) {}

  async all(): Promise<PromptRow[]> {
    const { rows } = await this.db.query<PromptRow>(
      `SELECT agent_key, block_key, version, text, note, created_by, created_at, active
         FROM agent_prompts ORDER BY agent_key, block_key, version DESC`,
    );
    return rows;
  }

  /** Новая версия блока, сразу действующая. Возвращает её номер. */
  async save(agent: string, block: string, text: string, note: string | null, by: string): Promise<number> {
    const c = await this.db.connect();
    try {
      await c.query('BEGIN');
      // Два сохранения разом не должны получить один номер версии.
      await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`prompt:${agent}:${block}`]);
      const { rows } = await c.query<{ next: number }>(
        'SELECT coalesce(max(version), 0)::int + 1 AS next FROM agent_prompts WHERE agent_key = $1 AND block_key = $2',
        [agent, block],
      );
      const version = rows[0]!.next;
      await c.query('UPDATE agent_prompts SET active = false WHERE agent_key = $1 AND block_key = $2 AND active', [agent, block]);
      await c.query(
        `INSERT INTO agent_prompts (agent_key, block_key, version, text, note, created_by, active)
         VALUES ($1, $2, $3, $4, $5, $6, true)`,
        [agent, block, version, text, note, by],
      );
      // В журнал — факт и размер, а не весь текст: версии с текстом и так лежат в agent_prompts.
      await c.query(
        `INSERT INTO audit_log (actor, service, action, entity_type, after, note)
         VALUES ($1, 'home-groups', 'prompt.save', 'prompt', $2::jsonb, $3)`,
        [by, JSON.stringify({ agent, block, version, length: text.length }), note],
      );
      await c.query('COMMIT');
      return version;
    } catch (err) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      c.release();
    }
  }

  /** Сделать действующей существующую версию (откат). false — такой версии нет. */
  async activate(agent: string, block: string, version: number, by: string): Promise<boolean> {
    const c = await this.db.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`prompt:${agent}:${block}`]);
      const exists = await c.query('SELECT 1 FROM agent_prompts WHERE agent_key = $1 AND block_key = $2 AND version = $3', [agent, block, version]);
      if ((exists.rowCount ?? 0) === 0) { await c.query('ROLLBACK'); return false; }
      await c.query('UPDATE agent_prompts SET active = false WHERE agent_key = $1 AND block_key = $2 AND active', [agent, block]);
      await c.query('UPDATE agent_prompts SET active = true WHERE agent_key = $1 AND block_key = $2 AND version = $3', [agent, block, version]);
      await c.query(
        `INSERT INTO audit_log (actor, service, action, entity_type, after)
         VALUES ($1, 'home-groups', 'prompt.activate', 'prompt', $2::jsonb)`,
        [by, JSON.stringify({ agent, block, version })],
      );
      await c.query('COMMIT');
      return true;
    } catch (err) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      c.release();
    }
  }
}
