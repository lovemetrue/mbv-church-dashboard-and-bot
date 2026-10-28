import { Fragment, type ReactNode } from 'react';
import styles from './Help.module.css';

/**
 * Небольшой разбор Markdown для статей базы знаний: заголовки, абзацы, списки, цитаты, таблицы, картинки, жирный,
 * курсив, код и ссылки. Библиотеку не тянем: статьи пишем сами, а всё строится элементами React — HTML из текста не
 * вставляется, поэтому разметка в статье не может выполнить скрипт.
 */
export function Markdown({ source, imageUrl }: { source: string; imageUrl: (path: string) => string }) {
  return <div className={styles.md}>{blocks(source.replace(/\r\n/g, '\n').split('\n'), imageUrl)}</div>;
}

const LIST = /^\s*(?:[-*]|\d+\.)\s+/;
const isTableRow = (l: string): boolean => /^\s*\|.*\|\s*$/.test(l);
const cells = (l: string): string[] => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

function blocks(lines: string[], imageUrl: (p: string) => string): ReactNode[] {
  const out: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === '') { i++; continue; }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const level = Math.min(h[1]!.length + 1, 5);
      const Tag = `h${level}` as 'h2' | 'h3' | 'h4' | 'h5';
      out.push(<Tag key={i}>{inline(h[2]!, imageUrl)}</Tag>);
      i++;
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { out.push(<hr key={i} />); i++; continue; }
    if (isTableRow(line)) {
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i]!)) {
        if (!/^\s*\|[\s:|-]+\|\s*$/.test(lines[i]!)) rows.push(cells(lines[i]!));
        i++;
      }
      const [head, ...body] = rows;
      out.push(
        <div key={`t${i}`} className={styles.tableWrap}>
          <table>
            {head && <thead><tr>{head.map((c, k) => <th key={k}>{inline(c, imageUrl)}</th>)}</tr></thead>}
            <tbody>{body.map((r, n) => <tr key={n}>{r.map((c, k) => <td key={k}>{inline(c, imageUrl)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i]!)) quote.push(lines[i++]!.replace(/^\s*>\s?/, ''));
      out.push(<blockquote key={`q${i}`}>{blocks(quote, imageUrl)}</blockquote>);
      continue;
    }
    if (LIST.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && (LIST.test(lines[i]!) || (/^\s{2,}\S/.test(lines[i]!) && items.length > 0))) {
        const l = lines[i++]!;
        if (LIST.test(l)) items.push(l.replace(LIST, ''));
        else items[items.length - 1] += ` ${l.trim()}`;
      }
      const List = ordered ? 'ol' : 'ul';
      out.push(<List key={`l${i}`}>{items.map((t, k) => <li key={k}>{inline(t, imageUrl)}</li>)}</List>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() !== '' && !/^(#{1,4})\s/.test(lines[i]!) && !LIST.test(lines[i]!) && !isTableRow(lines[i]!) && !/^\s*>/.test(lines[i]!)) {
      para.push(lines[i++]!.trim());
    }
    out.push(<p key={`p${i}`}>{inline(para.join(' '), imageUrl)}</p>);
  }
  return out;
}

const INLINE = /!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|`([^`]+)`|\*([^*\s][^*]*)\*/g;

/** Ссылки — только на сайты и почту: `javascript:` и прочее показываем текстом. */
const safeHref = (url: string): string | null => (/^(https?:|mailto:)/i.test(url) ? url : null);

function inline(text: string, imageUrl: (p: string) => string): ReactNode {
  const parts: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index! > last) parts.push(text.slice(last, m.index));
    const key = n++;
    if (m[2] !== undefined) parts.push(<img key={key} src={imageUrl(m[2])} alt={m[1] ?? ''} loading="lazy" />);
    else if (m[4] !== undefined) {
      const href = safeHref(m[4]);
      parts.push(href ? <a key={key} href={href} target="_blank" rel="noreferrer">{m[3]}</a> : <Fragment key={key}>{m[3]}</Fragment>);
    } else if (m[5] !== undefined) parts.push(<strong key={key}>{inline(m[5], imageUrl)}</strong>);
    else if (m[6] !== undefined) parts.push(<code key={key}>{m[6]}</code>);
    else if (m[7] !== undefined) parts.push(<em key={key}>{m[7]}</em>);
    last = m.index! + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
