const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Страница входа сервиса «Домашние группы».
 *
 * Без внешних шрифтов и скриптов: политика безопасности сервиса не пускает ничего чужого,
 * а странице входа и не нужно. Тема следует за системной. Логин намеренно не подсказываем.
 */
export function homeGroupsLoginPage(error?: string): string {
  return `<!doctype html>
<html lang="ru"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light dark">
<title>Домашние группы · вход</title>
<style>
  :root { --bg:#f6f7f9; --surface:#fff; --border:rgba(15,23,42,.12); --text:#14171c; --text-2:#5b6472;
          --accent:#4b57c4; --accent-hover:#3f4ab0; --on-accent:#fff; --field:#fff; --bad:#b42318; --bad-bg:rgba(180,35,24,.08); }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#08090a; --surface:#0f1011; --border:rgba(255,255,255,.09); --text:#ededef; --text-2:#9aa0aa;
            --accent:#6672e0; --accent-hover:#7a85e8; --on-accent:#0b0c0f; --field:#151719; --bad:#ff7b72; --bad-bg:rgba(248,81,73,.12); }
  }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; padding:24px;
         background:var(--bg); color:var(--text);
         font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,system-ui,sans-serif; }
  form { width:100%; max-width:340px; background:var(--surface); border:1px solid var(--border);
         border-radius:12px; padding:28px 26px; }
  h1 { margin:0; font-size:19px; font-weight:600; letter-spacing:-.01em; }
  p.sub { margin:6px 0 22px; color:var(--text-2); font-size:13px; line-height:1.45; }
  label { display:block; color:var(--text-2); font-size:12px; font-weight:500; margin-bottom:6px; }
  input { width:100%; height:40px; padding:0 12px; border-radius:8px; color:var(--text);
          background:var(--field); border:1px solid var(--border); font:inherit; font-size:15px; }
  input:focus-visible { outline:2px solid var(--accent); outline-offset:1px; border-color:transparent; }
  .field + .field { margin-top:12px; }
  button { width:100%; height:40px; margin-top:18px; border:0; border-radius:8px; background:var(--accent);
           color:var(--on-accent); font:inherit; font-size:15px; font-weight:600; cursor:pointer; }
  button:hover { background:var(--accent-hover); }
  button:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
  .err { margin:14px 0 0; padding:9px 11px; border-radius:8px; font-size:13px;
         color:var(--bad); background:var(--bad-bg); }
</style></head>
<body>
  <form method="post" action="/login">
    <h1>Домашние группы</h1>
    <p class="sub">Распределение заявок по группам. Доступ только для служителей.</p>
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
  </form>
</body></html>`;
}
