/**
 * Режет длинное сообщение на части: у Telegram лимит 4096 символов,
 * у MAX похожий. Материал дня кампании легко может его превысить.
 */
export function splitLongText(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];

  const parts: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    // Стараемся резать по переводу строки, чтобы не рвать абзац посреди фразы.
    const lineBreak = rest.lastIndexOf('\n', limit);
    const at = lineBreak > limit / 2 ? lineBreak : limit;
    parts.push(rest.slice(0, at));
    rest = rest.slice(at).replace(/^\n/, '');
  }
  if (rest) parts.push(rest);
  return parts;
}
