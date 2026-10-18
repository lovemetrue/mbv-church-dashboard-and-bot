/**
 * Поле с несколькими галочками («Состав»: «Мужская, Семейная») хранится одной строкой через запятую — так его
 * пишет таблица церкви и принимает сервер. Тело запроса — объект строк, повторить поле там нельзя.
 */
export const splitList = (value: string): string[] =>
  value
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * Отметить или снять одно значение. Порядок — как в списке, а не как нажимали: иначе одна и та же пара галочек
 * давала бы разные строки, и форма правки считала бы «Семейная, Мужская» изменением «Мужская, Семейная».
 * Значение не из списка (устаревшее, из таблицы) остаётся в конце, пока его не сняли.
 */
export function toggleInList(value: string, option: string, on: boolean, options: readonly string[]): string {
  const picked = new Set(splitList(value));
  if (on) picked.add(option);
  else picked.delete(option);
  const known = options.filter((o) => picked.has(o));
  const other = [...picked].filter((o) => !options.includes(o));
  return [...known, ...other].join(', ');
}

/** Варианты для галочек: список плюс уже отмеченное значение, которого в списке нет (иначе его нельзя было бы снять). */
export const optionsWithPicked = (options: readonly string[], value: string): string[] => [
  ...options,
  ...splitList(value).filter((v) => !options.includes(v)),
];
