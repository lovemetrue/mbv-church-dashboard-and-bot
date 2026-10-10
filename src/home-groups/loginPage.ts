export const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Страница входа сервиса «Домашние группы».
 *
 * Без внешних шрифтов и скриптов: политика безопасности сервиса не пускает ничего чужого,
 * а странице входа и не нужно. Тема следует за системной. Логин намеренно не подсказываем.
 */
/**
 * Общая оболочка страниц сервиса вне интерфейса (вход, «забыли пароль», задание пароля): без внешних
 * шрифтов и скриптов, тема следует за системной.
 */
export function pageShell(title: string, form: string): string {
  return `<!doctype html>
<html lang="ru"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(title)}</title>
<style>
  :root { --bg:#f6f7f9; --surface:#fff; --border:rgba(15,23,42,.12); --text:#14171c; --text-2:#5b6472;
          --accent:#4b57c4; --accent-hover:#3f4ab0; --on-accent:#fff; --field:#fff; --bad:#b42318; --bad-bg:rgba(180,35,24,.08);
          --ok:#1f7040; --ok-bg:rgba(31,112,64,.1); }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#08090a; --surface:#0f1011; --border:rgba(255,255,255,.09); --text:#ededef; --text-2:#9aa0aa;
            --accent:#6672e0; --accent-hover:#7a85e8; --on-accent:#0b0c0f; --field:#151719; --bad:#ff7b72; --bad-bg:rgba(248,81,73,.12);
            --ok:#5cc383; --ok-bg:rgba(92,195,131,.12); }
  }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; padding:24px;
         background:var(--bg); color:var(--text);
         font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,system-ui,sans-serif; }
  form, .card { width:100%; max-width:340px; background:var(--surface); border:1px solid var(--border);
         border-radius:12px; padding:28px 26px; }
  h1 { margin:0; font-size:19px; font-weight:600; letter-spacing:-.01em; }
  p.sub { margin:6px 0 22px; color:var(--text-2); font-size:13px; line-height:1.45; }
  label { display:block; color:var(--text-2); font-size:12px; font-weight:500; margin-bottom:6px; }
  input { width:100%; height:40px; padding:0 12px; border-radius:8px; color:var(--text);
          background:var(--field); border:1px solid var(--border); font:inherit; font-size:15px; }
  input:focus-visible { outline:2px solid var(--accent); outline-offset:1px; border-color:transparent; }
  .field + .field { margin-top:12px; }
  button { width:100%; height:44px; margin-top:18px; border:0; border-radius:8px; background:var(--accent);
           color:var(--on-accent); font:inherit; font-size:15px; font-weight:600; cursor:pointer; }
  button:hover { background:var(--accent-hover); }
  button:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
  .err { margin:14px 0 0; padding:9px 11px; border-radius:8px; font-size:13px; color:var(--bad); background:var(--bad-bg); }
  .note { margin:0 0 14px; padding:9px 11px; border-radius:8px; font-size:13px; color:var(--ok); background:var(--ok-bg); }
  .alt { display:block; margin-top:16px; text-align:center; font-size:13px; color:var(--text-2); }
  .alt a { color:var(--accent); }
  .hint { margin:6px 0 0; color:var(--text-2); font-size:12px; line-height:1.4; }
</style></head>
<body>
${form}
</body></html>`;
}

const NOTICES: Record<string, string> = {
  password_set: 'Пароль задан. Теперь можно войти.',
  reset_sent: 'Если такой пользователь есть, ссылка на смену пароля отправлена на его почту.',
};

/** Страница входа. Логин намеренно не подсказываем. `notice` — код короткого сообщения после других страниц. */
export function homeGroupsLoginPage(error?: string, notice?: string): string {
  const note = notice && NOTICES[notice] ? `<p class="note" role="status">${escapeHtml(NOTICES[notice]!)}</p>` : '';
  return pageShell('Домашние группы · вход', `  <form method="post" action="/login">
    <h1>Домашние группы</h1>
    <p class="sub">Распределение заявок по группам. Доступ только для служителей.</p>
    ${note}
    <div class="field">
      <label for="l">Логин</label>
      <input id="l" name="login" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" autofocus required>
    </div>
    <div class="field">
      <label for="p">Пароль</label>
      <input id="p" name="password" type="password" autocomplete="current-password" required>
    </div>
    <button type="submit">Войти</button>
    ${error ? `<p class="err" role="alert">${escapeHtml(error)}</p>` : ''}
    <span class="alt"><a href="/forgot">Забыли пароль?</a></span>
  </form>`);
}

/** «Забыли пароль»: форма и одинаковый ответ независимо от того, есть ли такой пользователь. */
export function forgotPage(sent = false): string {
  if (sent) {
    return pageShell('Домашние группы · сброс пароля', `  <div class="card">
    <h1>Проверьте почту</h1>
    <p class="sub">${escapeHtml(NOTICES['reset_sent']!)} Ссылка действует недолго и работает один раз.</p>
    <span class="alt"><a href="/login">Вернуться ко входу</a></span>
  </div>`);
  }
  return pageShell('Домашние группы · сброс пароля', `  <form method="post" action="/forgot">
    <h1>Сброс пароля</h1>
    <p class="sub">Введите логин или почту, и мы отправим на почту ссылку для нового пароля.</p>
    <div class="field">
      <label for="i">Логин или почта</label>
      <input id="i" name="identifier" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" autofocus required>
    </div>
    <button type="submit">Отправить ссылку</button>
    <span class="alt"><a href="/login">Вернуться ко входу</a></span>
  </form>`);
}

/** Страница по ссылке из письма. `info` нет — ссылка недействительна (без подробностей: что именно не так, не раскрываем). */
export function setPasswordPage(token: string, info: { fullName: string; login: string } | null, error?: string): string {
  if (!info) {
    return pageShell('Домашние группы · пароль', `  <div class="card">
    <h1>Ссылка не работает</h1>
    <p class="sub">Ссылка недействительна, устарела или уже использована. Попросите администратора выслать новую или воспользуйтесь «Забыли пароль».</p>
    <span class="alt"><a href="/forgot">Забыли пароль?</a> · <a href="/login">Ко входу</a></span>
  </div>`);
  }
  return pageShell('Домашние группы · задайте пароль', `  <form method="post" action="/set-password">
    <h1>Задайте пароль</h1>
    <p class="sub">${escapeHtml(info.fullName)}, ваш логин: <b>${escapeHtml(info.login)}</b>.</p>
    <input type="hidden" name="token" value="${escapeHtml(token)}">
    <div class="field">
      <label for="p1">Новый пароль</label>
      <input id="p1" name="password" type="password" autocomplete="new-password" minlength="10" maxlength="128" autofocus required>
      <p class="hint">Не короче 10 знаков, не только цифры. Хорошо работает фраза из нескольких слов.</p>
    </div>
    <div class="field">
      <label for="p2">Повторите пароль</label>
      <input id="p2" name="password2" type="password" autocomplete="new-password" minlength="10" maxlength="128" required>
    </div>
    <button type="submit">Сохранить пароль</button>
    ${error ? `<p class="err" role="alert">${escapeHtml(error)}</p>` : ''}
  </form>`);
}
