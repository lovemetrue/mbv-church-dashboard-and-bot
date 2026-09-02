/** Страница входа. Оформлена как дашборд: тот же фон, шрифт и акцент. */
export function loginPage(error?: string): string {
  return `<!doctype html>
<html lang="ru"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Home Groups Analytics</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600&display=swap">
<style>
  :root { --bg:#08090A; --surface:#0F1011; --border:rgba(255,255,255,.07); --text:#EDEDEF;
          --text-2:#8A8F98; --accent:#5E6AD2; --bad:#F85149; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; padding:24px;
         background:var(--bg); color:var(--text);
         font-family:'Manrope',-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif; }
  form { width:100%; max-width:340px; background:var(--surface); border:1px solid var(--border);
         border-radius:12px; padding:28px 26px; }
  .mark { width:34px; height:34px; border-radius:9px; background:rgba(94,106,210,.16);
          border:1px solid rgba(94,106,210,.35); display:grid; place-items:center; margin-bottom:18px; }
  .mark svg { width:17px; height:17px; stroke:#7A85E0; fill:none; stroke-width:2;
              stroke-linecap:round; stroke-linejoin:round; }
  h1 { margin:0; font-size:18px; font-weight:600; letter-spacing:-.02em; }
  p.sub { margin:5px 0 22px; color:var(--text-2); font-size:13px; }
  label { display:block; color:var(--text-2); font-size:12px; font-weight:500; margin-bottom:6px; }
  input { width:100%; height:38px; padding:0 12px; border-radius:8px; color:var(--text);
          background:#151719; border:1px solid var(--border); font:inherit; font-size:14px; }
  input:focus { outline:none; border-color:var(--accent); }
  button { width:100%; height:38px; margin-top:16px; border-radius:8px; background:var(--accent);
           color:#fff; font:inherit; font-size:14px; font-weight:600; cursor:pointer; }
  button:hover { background:#6D78DC; }
  .err { margin:14px 0 0; padding:9px 11px; border-radius:8px; font-size:12.5px;
         color:var(--bad); background:rgba(248,81,73,.1); border:1px solid rgba(248,81,73,.22); }
</style></head>
<body>
  <form method="post" action="/groups/login">
    <span class="mark" aria-hidden="true">
      <svg viewBox="0 0 24 24"><path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V21h13V9.5"/><path d="M12 21v-5"/></svg>
    </span>
    <h1>Home Groups Analytics</h1>
    <p class="sub">Статистика домашних групп. Доступ только для служителей.</p>
    <label for="p">Пароль</label>
    <input id="p" name="password" type="password" autocomplete="current-password" autofocus required>
    <button type="submit">Войти</button>
    ${error ? `<p class="err">${error}</p>` : ''}
  </form>
</body></html>`;
}
