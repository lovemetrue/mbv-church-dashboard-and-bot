# Таймер ежедневного бэкапа

`scripts/deploy.sh` при каждом деплое сам копирует `church40-backup.service` и
`church40-backup.timer` в `/etc/systemd/system/` и включает таймер — но только если
у пользователя, от которого идёт деплой, есть root или passwordless `sudo`. Если нет —
деплой не падает, а печатает предупреждение, и таймер нужно поставить вручную один раз
командами ниже (их же можно повторить, если файлы юнитов поменялись, а деплой их
подхватить не смог).

Бэкап (`scripts/backup.sh`) кладёт сжатый дамп в `backups/` и хранит две недели —
дальше файл нужно забирать с сервера самостоятельно, автозаливки никуда нет (пробовали
Google Drive через сервис-аккаунт — Google требует для этого Shared Drive, платную
функцию Workspace, или OAuth-вход живым пользователем; решили не усложнять).

Скачать текущий дамп на свой компьютер:

```bash
scp root@<host>:/opt/church40bot/backups/church40-*.dump .
```

## Поставить юниты вручную (если деплой не смог сам)

```bash
sudo cp deploy/systemd/church40-backup.service deploy/systemd/church40-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now church40-backup.timer
```

Проверить расписание и последний запуск:

```bash
systemctl list-timers church40-backup.timer
journalctl -u church40-backup.service --since -2d
```

Запустить вне расписания, для проверки:

```bash
sudo systemctl start church40-backup.service
```
