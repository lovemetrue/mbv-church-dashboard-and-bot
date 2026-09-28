# Таймер бэкапа на Google Drive

`scripts/deploy.sh` при каждом деплое сам копирует `church40-backup.service` и
`church40-backup.timer` в `/etc/systemd/system/` и включает таймер — но только если
у пользователя, от которого идёт деплой, есть root или passwordless `sudo`. Если нет —
деплой не падает, а печатает предупреждение, и таймер нужно поставить вручную один раз
командами ниже (их же можно повторить, если файлы юнитов поменялись, а деплой их
подхватить не смог).

Это разовая ручная настройка на сервере — из этой репы её выполнить нельзя, потому что
она требует и root-доступа, и интерактивного входа в Google (OAuth-ключ нигде в коде не
хранится и в CI не передаётся).

## 1. Установить rclone

```bash
curl https://rclone.org/install.sh | sudo bash
```

## 2. Завести remote для Google Drive

```bash
rclone config
```

Выбрать `n` (new remote), имя — `gdrive` (по умолчанию его же ждёт `scripts/backup.sh`;
другое имя — тогда пропишите `GDRIVE_REMOTE=` в `.env` на сервере), тип — `drive`.
Дальше два варианта, смотря что за OAuth-ключ есть под рукой:

- **Client ID/secret обычного OAuth-приложения** — `rclone config` откроет браузер для
  входа в Google-аккаунт (`rclone authorize`, если сервер без графики). Токен рефрешится
  сам, повторно логиниться не придётся.
- **Service account JSON** — на шаге `service_account_file` укажите путь к файлу с ключом
  (сам файл на сервер кладите вручную, вне git — например, `/opt/church40bot/gdrive.json`,
  права `600`).

Если скрипт бэкапа запускается не от root (юнит по умолчанию запускает его от root,
см. `church40-backup.service`), а `rclone config` заводили от другого пользователя —
пропишите в `.env` `RCLONE_CONFIG=/home/<пользователь>/.config/rclone/rclone.conf`
и добавьте `EnvironmentFile=/opt/church40bot/.env` в `[Service]` юнита, либо просто
переустановите remote от root, чтобы конфиг лежал там, где его ищет таймер.

Проверка, что заливка работает:

```bash
echo test | rclone rcat gdrive:church40-backups/_ping.txt && rclone deletefile gdrive:church40-backups/_ping.txt
```

## 3. Поставить юниты вручную (если деплой не смог сам)

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
