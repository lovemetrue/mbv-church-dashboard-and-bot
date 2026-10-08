/**
 * Очередь входящих апдейтов: разные люди обрабатываются одновременно, один человек — строго по порядку.
 *
 * Обе библиотеки опроса (grammY и MAX) ждут завершения обработчика, прежде чем взять
 * следующий апдейт, поэтому при ста людях в анкете каждый стоял бы в общей очереди за
 * всеми, а на медленном шаге (отправка карточки с QR, уведомление служителям) вставала бы
 * вся очередь. Здесь submit возвращается, когда апдейт принят в работу, а не когда он
 * обработан, — библиотека берёт следующий. Лимит `limit` держит нагрузку на базу и API
 * платформ: когда все места заняты, submit ждёт, и опрос сам притормаживает.
 *
 * Порядок внутри одного человека обязателен: анкета читает и пишет его состояние целиком,
 * и два шага одновременно перетёрли бы друг друга (например, двойное нажатие кнопки).
 */
export class UpdateQueue {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly waiting: Array<() => void> = [];
  private active = 0;

  constructor(
    private readonly limit: number,
    private readonly onError: (err: unknown) => void,
  ) {}

  /** Сколько апдейтов принято и ещё не обработано. */
  get pending(): number {
    return this.active;
  }

  async submit(key: string, task: () => Promise<void>): Promise<void> {
    while (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.active += 1;

    const previous = this.tails.get(key) ?? Promise.resolve();
    const run: Promise<void> = previous
      .then(task)
      .catch(this.onError)
      .finally(() => {
        this.active -= 1;
        if (this.tails.get(key) === run) this.tails.delete(key);
        this.waiting.shift()?.();
      });
    this.tails.set(key, run);
  }

  /** Ждёт, пока обработается всё принятое: нужно при остановке процесса. */
  async idle(): Promise<void> {
    while (this.tails.size > 0) await Promise.all([...this.tails.values()]);
  }
}
