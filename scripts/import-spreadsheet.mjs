#!/usr/bin/env node
/**
 * Переносит выгрузку Google-таблицы в базу.
 *
 * Вход — dashboard/data.json, его делает dashboard/tools/extract.py из .xlsx.
 * Выход — строки в groups (source='таблица'), requests (origin='таблица') и coordinators.
 *
 *   npm run import:spreadsheet
 *   node scripts/import-spreadsheet.mjs путь/к/data.json
 *
 * Скрипт идемпотентен: сначала удаляет ранее импортированное, потом вставляет заново.
 * Именно так, а не upsert-ом: у 32 групп из 116 нет номера в реестре, естественного
 * ключа не существует, а в листе есть настоящий дубль (одна ведущая записана дважды) —
 * сверять по содержимому значит его потерять.
 *
 * Правленое и удалённое в дашборде импорт не трогает: такие строки помечены источником
 * «ui», и заново из выгрузки они не вставляются (см. isAdopted ниже).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.argv[2] ?? path.join(ROOT, 'dashboard', 'data.json');

/** Пустая строка в выгрузке значит «не заполнено», в базе этому соответствует NULL. */
const orNull = (v) => (v === '' || v === undefined ? null : v);

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Не задана переменная окружения DATABASE_URL');

  const { groups = [], requests = [], coordinators = [] } = JSON.parse(readFileSync(DATA, 'utf8'));
  console.log(`Читаю ${path.relative(ROOT, DATA)}: групп ${groups.length}, заявок ${requests.length}, координаторов ${coordinators.length}`);

  const db = new pg.Client({ connectionString: url });
  await db.connect();

  try {
    await db.query('BEGIN');

    const removed = {
      groups: (await db.query(`DELETE FROM groups WHERE source = 'таблица'`)).rowCount,
      requests: (await db.query(`DELETE FROM requests WHERE origin = 'таблица'`)).rowCount,
      coordinators: (await db.query(`DELETE FROM coordinators WHERE source = 'таблица'`)).rowCount,
    };

    /*
     * Правленое и удалённое в дашборде импорт не возвращает.
     *
     * Любая правка или удаление в дашборде переводит строку из «таблица» в «ui» — такие
     * строки удаление выше не затронуло, они остались. Значит их надо узнать и не
     * вставлять заново, иначе появится дубль (а удалённое ещё и воскреснет).
     *
     * Узнаём по номеру в реестре, а если его нет — по ведущему, формату и району:
     * у 32 групп из 116 номера нет вовсе.
     */
    const adopted = await db.query(
      `SELECT no, leader, format, district FROM groups WHERE source <> 'таблица'`,
    );
    const byNo = new Set(adopted.rows.filter((r) => r.no !== null).map((r) => r.no));
    const bySignature = new Set(
      adopted.rows.filter((r) => r.no === null).map((r) => `${r.leader}|${r.format}|${r.district}`),
    );
    const isAdopted = (g) =>
      g.no !== null && g.no !== undefined
        ? byNo.has(g.no)
        : bySignature.has(`${g.leader}|${g.format}|${g.district}`);

    let skipped = 0;
    for (const g of groups) {
      if (isAdopted(g)) {
        skipped += 1;
        continue;
      }
      await db.query(
        `INSERT INTO groups (no, leader, open_to_new, phone, phones, age, district, metro, address,
                             composition, day, "time", people, coordinator, feedback_at, comment,
                             training, format, status, checked, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,'таблица')`,
        [
          g.no ?? null, g.leader, orNull(g.open_to_new), orNull(g.phone), g.phones ?? [],
          orNull(g.age), g.district, orNull(g.metro), orNull(g.address), orNull(g.composition),
          orNull(g.day), orNull(g.time), g.people ?? null, orNull(g.coordinator),
          orNull(g.feedback_at), orNull(g.comment), orNull(g.training), g.format, g.status,
          g.checked ?? null,
        ],
      );
    }

    for (const r of requests) {
      // Строка листа — это человек, который хочет в домашнюю группу: тот же тип,
      // что создаёт бот кнопкой «Хочу присоединиться».
      await db.query(
        `INSERT INTO requests (type, status, fio, phone, phones, age, place, responsible, source,
                               ministry, note, extra, recommended, recommended_at, final_group,
                               cancel_reason, attendance, requested_at, origin)
         VALUES ('join_group',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'таблица')`,
        [
          r.status, r.fio, orNull(r.phone), r.phones ?? [], orNull(r.age), orNull(r.place),
          orNull(r.responsible), orNull(r.source), orNull(r.ministry), orNull(r.note),
          orNull(r.extra), orNull(r.recommended), orNull(r.recommended_at), orNull(r.final_group),
          orNull(r.cancel_reason), orNull(r.attendance), orNull(r.date),
        ],
      );
    }

    for (const c of coordinators) {
      await db.query(
        `INSERT INTO coordinators (name, role, source) VALUES ($1, $2, 'таблица')`,
        [c.name, c.role],
      );
    }

    await db.query('COMMIT');

    console.log(`Удалено ранее импортированного: групп ${removed.groups}, заявок ${removed.requests}, координаторов ${removed.coordinators}`);
    console.log(`Вставлено: групп ${groups.length - skipped}, заявок ${requests.length}, координаторов ${coordinators.length}`);
    if (skipped > 0) {
      console.log(`Пропущено групп, которые ведутся в дашборде: ${skipped}`);
    }
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error('Импорт не выполнен:', err.message);
  process.exit(1);
});
