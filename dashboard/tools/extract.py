#!/usr/bin/env python3
"""Достаёт данные о домашних группах из выгрузки Google-таблицы (.xlsx) в JSON для дашборда.

Переносится весь лист «МАЛЫЕ ГРУППЫ (2026)», включая телефоны, адреса и комментарии.
Помните: адрес в таблице помечен «только для внутреннего пользования, людям не давать»,
поэтому дашборд закрыт паролем и запрещён к индексации.

    python3 tools/extract.py "Домашняя группа (Ответы).xlsx" > data.json
"""
import sys
import re
import json
import zipfile
import datetime
from xml.etree import ElementTree as ET

M = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
PR = 'http://schemas.openxmlformats.org/package/2006/relationships'

# Статусы заявок. Нужны не только для показа: в столбце «ОТВЕТСТВЕННЫЙ» у части
# строк вместо имени затёк статус, и по этому списку такие значения отбрасываем.
REQUEST_STATUSES = {'Аннулирована', 'В работе', 'Исполнена', 'На контроле', 'В ожидании'}

# Колонки листа «ЗАЯВКИ» по буквам
REQ = {
    'responsible': 'A', 'status': 'B', 'date': 'C', 'fio': 'E', 'phone': 'F',
    'age': 'G', 'place': 'H', 'source': 'I', 'ministry': 'J', 'note': 'K',
    'extra': 'L', 'recommended': 'M', 'recommended_at': 'N', 'final_group': 'O',
    'cancel_reason': 'P', 'attendance': 'Q',
}

# Колонки листа «МАЛЫЕ ГРУППЫ (2026)» по буквам — все, что есть на листе
COL = {
    'no': 'A', 'leader': 'B', 'open_to_new': 'C', 'phone': 'D', 'age': 'E',
    'district': 'F', 'metro': 'G', 'address': 'H', 'composition': 'I', 'day': 'J',
    'time': 'K', 'people': 'L', 'coordinator': 'M', 'feedback': 'N',
    'comment': 'O', 'training': 'P', 'format': 'Q', 'status': 'R', 'checked': 'S',
}


def load(path):
    z = zipfile.ZipFile(path)
    rels = {r.get('Id'): r.get('Target')
            for r in ET.fromstring(z.read('xl/_rels/workbook.xml.rels')).iter('{%s}Relationship' % PR)}
    wb = ET.fromstring(z.read('xl/workbook.xml'))
    sheets = {s.get('name'): 'xl/' + rels[s.get('{%s}id' % R)].lstrip('/')
              for s in wb.iter('{%s}sheet' % M)}
    shared = [''.join(t.text or '' for t in si.iter('{%s}t' % M))
              for si in ET.fromstring(z.read('xl/sharedStrings.xml')).iter('{%s}si' % M)]
    return z, sheets, shared


def make_reader(shared):
    def val(c):
        t, v = c.get('t'), c.find('{%s}v' % M)
        if t == 's' and v is not None and v.text is not None:
            return shared[int(v.text)]
        if t == 'inlineStr':
            return ''.join(x.text or '' for x in c.iter('{%s}t' % M))
        return v.text if v is not None and v.text is not None else ''
    return val


def grid(z, path, val):
    rows = []
    for row in ET.fromstring(z.read(path)).iter('{%s}row' % M):
        cells = {}
        for c in row.iter('{%s}c' % M):
            letter = ''.join(ch for ch in (c.get('r') or '') if ch.isalpha())
            cells[letter] = val(c)
        rows.append(cells)
    return rows


def clean(s):
    return ' '.join((s or '').replace('\n', ' ').split()).strip()


def to_date(s):
    """Excel хранит даты числом дней от 30.12.1899."""
    try:
        n = float(s)
    except (TypeError, ValueError):
        return None
    if not 20000 < n < 60000:
        return None
    return (datetime.date(1899, 12, 30) + datetime.timedelta(days=int(n))).isoformat()


def multiline(s):
    """Комментарий и телефоны бывают в несколько строк — склеиваем через «; »."""
    parts = [' '.join(p.split()) for p in (s or '').replace(';', '\n').split('\n')]
    return '; '.join(p for p in parts if p)


def to_time(s):
    """Время лежит в двух видах: долей суток (0.7916… = 19:00) и текстом («19.00»)."""
    txt = clean(s)
    if not txt:
        return None
    # Текстовая запись. Час должен быть от 1: иначе «0.50» приняли бы за 00:50,
    # хотя это доля суток, то есть полдень.
    m = re.fullmatch(r'(\d{1,2})[.:](\d{2})', txt)
    if m and 1 <= int(m.group(1)) < 24 and int(m.group(2)) < 60:
        return f'{int(m.group(1)):02d}:{int(m.group(2)):02d}'
    try:
        n = float(txt)
    except ValueError:
        return txt
    if not 0 <= n < 1:
        return txt
    minutes = round(n * 24 * 60)
    return f'{minutes // 60:02d}:{minutes % 60:02d}'


def digits_only(s):
    return ''.join(ch for ch in s if ch.isdigit())


def to_e164(digits):
    """Российский номер к виду +7XXXXXXXXXX."""
    if len(digits) == 11 and digits[0] in '78':
        return '+7' + digits[1:]
    if len(digits) == 10:
        return '+7' + digits
    return None


def ru_numbers(chunk):
    """Номера из строки, где пробел бывает и внутри номера, и между номерами.

    «8 (900) 111-22-33» — один номер, разбитый пробелами;
    «89001112233 89004445566» — два номера подряд.
    Поэтому копим цифры и отрезаем номер, как только их набралось на полный.
    """
    out, acc = [], ''
    for token in chunk.split():
        d = digits_only(token)
        if not d:
            continue
        if len(d) >= 10 and acc:      # в токене уже целый номер — прежний закрываем
            num = to_e164(acc)
            if num:
                out.append(num)
            acc = ''
        acc += d
        while len(acc) >= 11:
            take = 11 if acc[0] in '78' else 10
            num = to_e164(acc[:take])
            if num:
                out.append(num)
            acc = acc[take:]
    if acc:
        num = to_e164(acc)
        if num:
            out.append(num)
    return out


def phones(s):
    """Телефоны из ячейки.

    В таблице они лежат по-разному: текстом с именами и переносами строк,
    числом (Google-таблица решила, что это число: «8.900111222E10»),
    и изредка зарубежным номером с плюсом. Возвращаем текст для показа
    и список номеров для ссылок «позвонить».
    """
    raw = s or ''
    try:
        n = float(raw)
        if n > 1e9:
            raw = f'{n:.0f}'
    except (TypeError, ValueError):
        pass

    text = multiline(raw)
    found, seen = [], set()
    for chunk in text.split(';'):
        if not chunk.strip():
            continue
        if '+' in chunk:              # зарубежный: код страны свой, не подставляем +7
            d = digits_only(chunk)
            nums = ['+' + d] if 11 <= len(d) <= 15 else ru_numbers(chunk)
        else:
            nums = ru_numbers(chunk)
        for num in nums:
            if num not in seen:
                seen.add(num)
                found.append(num)
    return text or None, found


def to_int(s):
    try:
        return round(float(s))
    except (TypeError, ValueError):
        return None


def normalize_district(raw):
    d = clean(raw).replace('№)', '').strip()
    if d.upper() == 'ОНЛАЙН':
        return 'Онлайн'
    if d.lower().startswith('ленинград'):
        return 'Ленинградская область'
    return d or 'Не указан'


def main(path):
    z, sheets, shared = load(path)
    val = make_reader(shared)

    groups = []
    for r in grid(z, sheets['МАЛЫЕ ГРУППЫ (2026)'], val)[1:]:
        leader = clean(r.get(COL['leader']))
        if not leader:
            continue
        phone_text, phone_list = phones(r.get(COL['phone']))
        groups.append({
            'no': to_int(r.get(COL['no'])),
            'leader': leader,
            'open_to_new': clean(r.get(COL['open_to_new'])),
            'phone': phone_text,
            'phones': phone_list,
            'age': clean(r.get(COL['age'])),
            'district': normalize_district(r.get(COL['district'])),
            'metro': clean(r.get(COL['metro'])),
            'address': clean(r.get(COL['address'])) or None,
            'composition': clean(r.get(COL['composition'])),
            'day': clean(r.get(COL['day'])),
            'time': to_time(r.get(COL['time'])),
            'people': to_int(r.get(COL['people'])),
            'coordinator': clean(r.get(COL['coordinator'])),
            'feedback_at': to_date(r.get(COL['feedback'])),
            'comment': multiline(r.get(COL['comment'])) or None,
            'training': clean(r.get(COL['training'])) or None,
            'format': clean(r.get(COL['format'])) or 'Не указан',
            'status': clean(r.get(COL['status'])) or 'Не указан',
            'checked': clean(r.get(COL['checked'])) == '1',
        })

    requests = []
    for r in grid(z, sheets['ЗАЯВКИ'], val)[1:]:
        fio = clean(r.get(REQ['fio']))
        if not fio:
            continue
        phone_text, phone_list = phones(r.get(REQ['phone']))
        responsible = clean(r.get(REQ['responsible']))
        requests.append({
            'fio': fio,
            # Затёкший в эту графу статус именем не считаем.
            'responsible': None if responsible in REQUEST_STATUSES else (responsible or None),
            'status': clean(r.get(REQ['status'])) or 'Не указан',
            'date': to_date(r.get(REQ['date'])),
            'phone': phone_text,
            'phones': phone_list,
            'age': clean(r.get(REQ['age'])) or None,
            'place': clean(r.get(REQ['place'])) or None,
            'source': clean(r.get(REQ['source'])) or None,
            'ministry': clean(r.get(REQ['ministry'])) or None,
            'note': multiline(r.get(REQ['note'])) or None,
            'extra': multiline(r.get(REQ['extra'])) or None,
            'recommended': clean(r.get(REQ['recommended'])) or None,
            'recommended_at': to_date(r.get(REQ['recommended_at'])),
            'final_group': clean(r.get(REQ['final_group'])) or None,
            'cancel_reason': clean(r.get(REQ['cancel_reason'])) or None,
            'attendance': clean(r.get(REQ['attendance'])) or None,
        })

    coordinators, role = [], 'Координатор малых групп'
    for r in grid(z, sheets['Координаторы'], val)[1:]:
        marker = clean(r.get('A'))
        if 'Молодеж' in marker:
            role = 'Молодёжный координатор'
        elif 'Координатор' in marker:
            role = 'Координатор малых групп'
        name = clean(r.get('C'))
        if name and name.lower() != 'имя и фамилия':
            coordinators.append({'name': name, 'role': role})

    print(json.dumps({'groups': groups, 'requests': requests, 'coordinators': coordinators},
                     ensure_ascii=False, separators=(',', ':')))


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
