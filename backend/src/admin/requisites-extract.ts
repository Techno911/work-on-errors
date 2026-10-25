import * as fs from 'fs';
import * as path from 'path';
import { PDFParse } from 'pdf-parse';
import * as mammoth from 'mammoth';
import type { LegalInfoData } from '../companies/entities/company.entity';

/**
 * Реквизиты исполнителя (задаётся через EXECUTOR_* env). В договоре ВСЕГДА две стороны, и наши реквизиты
 * стоят первыми. Их нельзя выдать за реквизиты заказчика: подставленный клиенту наш адрес
 * выглядит правдоподобно и не вызывает ошибки — самый тихий и самый дорогой класс дефекта.
 * Значения ниже работают как чёрный список на выходе.
 */
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Реквизиты собственной стороны (исполнителя) задаются через env:
 * EXECUTOR_INNS="123456789012,…", EXECUTOR_NAME_PATTERN="Фамилия\s+Имя",
 * EXECUTOR_ADDRESS_PATTERN="Улица\s+Такая". Пустая конфигурация = фильтр выключен.
 * Вычисляется лениво, чтобы тесты могли подставить свои значения через process.env.
 */
function executorRules() {
  const inns = (process.env.EXECUTOR_INNS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const name = (process.env.EXECUTOR_NAME_PATTERN || '').trim();
  const address = (process.env.EXECUTOR_ADDRESS_PATTERN || '').trim();
  const mention = [inns.map(escapeRe).join('|'), name, address].filter(Boolean).join('|');
  return {
    inn: new Set(inns),
    name: name ? new RegExp(name, 'i') : /^$/,
    address: address ? new RegExp(address, 'i') : /^$/,
    /** Любое упоминание своей стороны — по нему отрезается левая граница зоны заказчика. */
    anyMention: mention ? new RegExp(mention, 'gi') : /^$/gi,
  };
}

/** Насколько далеко от «ИНН заказчика» ещё считаем текст его реквизитами. */
const ZONE_RADIUS = 700;

/**
 * Хвосты, которыми в договорах продолжается предложение после значения реквизита.
 * По первому такому маркеру значение обрезается: он означает «реквизит кончился».
 */
// Внимание: \b в JS работает по латинице, поэтому границы слов задаются через (?![а-яё]).
const VALUE_STOP =
  /\s*(?:\(?\s*далее(?![а-яё])|именуем|действующ|в лице(?![а-яё])|с одной стороны|с другой стороны|заключил|паспорт(?![а-яё])|телефон(?![а-яё])|тел\.|e-?mail|почт|банковск|банк(?![а-яё])|р\/с|расч[ёе]тн|p\/c|к\/с|бик(?![а-яё])|основание(?![а-яё])|ИНН(?![А-ЯЁа-яё])|КПП(?![А-ЯЁа-яё])|ОГРН|св-во|свидетельств)/i;

/** Наименование организации: полная форма, аббревиатура, ИП, иностранная форма. */
const NAME_PATTERNS: RegExp[] = [
  /(?:ОБЩЕСТВО\s+С\s+ОГРАНИЧЕННОЙ\s+ОТВЕТСТВЕННОСТЬЮ|(?:ПУБЛИЧНОЕ\s+|НЕПУБЛИЧНОЕ\s+)?АКЦИОНЕРНОЕ\s+ОБЩЕСТВО)\s*[«"“”„][^»"“”„]{2,120}[»"“”]/i,
  /\b(?:ООО|АО|ПАО|ЗАО|ОАО|НАО)\s*[«"“”„][^»"“”„]{2,120}[»"“”]/,
  /(?:Индивидуальный\s+предприниматель|\bИП)\s+[А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+){1,2}/i,
  /[A-Z][A-Za-z0-9&.\-\s]{1,60}\s(?:s\.r\.o\.|d\.o\.o\.|LLC|Ltd\.?|GmbH|SIA|UAB|O[ÜU])\b/,
  /(?:s\.r\.o\.|d\.o\.o\.|LLC|Ltd\.?|GmbH)\s+[A-Z][A-Za-z0-9&.\-\s]{1,60}/,
];

/**
 * Извлечение реквизитов ЗАКАЗЧИКА из файла договора (PDF или Word .docx).
 * Best-effort: возвращает только уверенно распознанные поля; трекер проверяет перед сохранением.
 * .doc (старый бинарный), .rtf и сканы без текстового слоя не парсятся — вернём пусто.
 */
export async function extractRequisites(absPath: string): Promise<Partial<LegalInfoData>> {
  const ext = path.extname(absPath).toLowerCase();
  let text = '';
  try {
    if (ext === '.pdf') {
      const buf = fs.readFileSync(absPath);
      const parser = new PDFParse({ data: new Uint8Array(buf) });
      const res = await parser.getText();
      text = res.text || '';
      await parser.destroy();
    } else if (ext === '.docx') {
      const res = await mammoth.extractRawText({ path: absPath });
      text = res.value || '';
    }
  } catch {
    return {}; // битый/нечитаемый файл — не роняем загрузку, просто без автозаполнения
  }
  return extractRequisitesFromText(text);
}

/**
 * Чистая функция извлечения — тестируется на реальных формулировках договоров без файлов.
 *
 * Механика: реквизиты в любом документе группируются вокруг ИНН. Берём окно текста вокруг
 * каждого ИНН, выбрасываем окна с нашим ИНН (исполнитель) и разбираем оставшиеся. Так поле
 * заказчика физически не может подтянуться из блока исполнителя, даже если у заказчика
 * этого поля в документе нет: тогда поле просто останется пустым.
 */
export function extractRequisitesFromText(raw: string): Partial<LegalInfoData> {
  const flat = normalize(raw);
  if (!flat) return {};

  const zones = customerZones(flat);
  if (!zones.length) return {};

  const out: Partial<LegalInfoData> = {};
  for (const zone of zones) {
    take(out, 'inn', zone.inn);
    take(out, 'ogrn', pick(zone.text, /ОГРН(?:ИП)?[:\s№]*(\d{15}|\d{13})(?!\d)/i));
    take(out, 'kpp', pick(zone.text, /КПП[:\s№]*(\d{9})(?!\d)/i));
    take(out, 'legalName', legalName(zone.text));
    take(out, 'address', address(zone.text));
  }

  // Страховка на случай, если формат договора изменится и зона съедет: наши собственные
  // реквизиты не уходят клиенту ни при каких обстоятельствах.
  const exec = executorRules();
  if (out.inn && exec.inn.has(out.inn)) delete out.inn;
  if (out.legalName && exec.name.test(out.legalName)) delete out.legalName;
  if (out.address && exec.address.test(out.address)) delete out.address;

  return out;
}

/** Первое непустое значение выигрывает: зоны отсортированы от самой достоверной. */
function take(out: Partial<LegalInfoData>, key: keyof LegalInfoData, value?: string): void {
  if (value && !out[key]) (out as Record<string, string>)[key] = value;
}

/**
 * Единый текст документа: неразрывные пробелы и переносы строк становятся обычными пробелами,
 * кавычки приводятся к «ёлочкам». Границы абзацев теряются намеренно — реквизиты в договорах
 * разорваны по строкам произвольно, а стоп-маркеры работают надёжнее переводов строки.
 */
function normalize(raw: string): string {
  return (raw || '')
    .replace(/ | | /g, ' ')
    .replace(/­/g, '')
    .replace(/[“„]/g, '«')
    .replace(/”/g, '»')
    .replace(/\s+/g, ' ')
    .trim();
}

interface Zone { inn: string; text: string; trusted: boolean }

/**
 * Зоны заказчика — окна вокруг каждого ИНН, кроме нашего. Окно ограничено соседними ИНН,
 * чтобы реквизиты сторон не перетекали друг в друга. Зоны из раздела «Реквизиты сторон»
 * идут первыми: там значения уже очищены от клаузул договора.
 */
function customerZones(flat: string): Zone[] {
  const hits = [...flat.matchAll(/ИНН[:\s№]*(\d{12}|\d{10})(?!\d)/gi)];
  if (!hits.length) return [];

  const requisitesAt = flat.search(/РЕКВИЗИТЫ\s+СТОРОН/i);
  const zones: Zone[] = [];
  hits.forEach((hit, i) => {
    const inn = hit[1];
    if (executorRules().inn.has(inn)) return;
    const at = hit.index ?? 0;
    const prevEnd = i > 0 ? (hits[i - 1].index ?? 0) + hits[i - 1][0].length : 0;
    const nextStart = i + 1 < hits.length ? (hits[i + 1].index ?? flat.length) : flat.length;
    // Реквизиты сторон идут блоками: данные заказчика начинаются после ПОСЛЕДНЕГО упоминания
    // исполнителя слева. Без этой границы «Адрес» исполнителя оказывается ближайшим к ИНН
    // заказчика и уезжает клиенту как его собственный (поймано на реальных счетах клиентов).
    const from = afterLastExecutorMention(flat, Math.max(prevEnd, at - ZONE_RADIUS), at);
    zones.push({
      inn,
      text: flat.slice(from, Math.min(nextStart, at + ZONE_RADIUS)),
      trusted: requisitesAt >= 0 && at > requisitesAt,
    });
  });
  return zones.sort((a, b) => Number(b.trusted) - Number(a.trusted));
}

/** Сдвигает левую границу зоны за последнее упоминание исполнителя в отрезке [from, before). */
function afterLastExecutorMention(flat: string, from: number, before: number): number {
  const head = flat.slice(from, before);
  let last = from;
  for (const m of head.matchAll(executorRules().anyMention)) {
    last = from + (m.index ?? 0) + m[0].length;
  }
  return last;
}

function pick(zone: string, re: RegExp): string | undefined {
  const m = zone.match(re);
  return m ? m[1] : undefined;
}

/** Наименование заказчика. Банки отбрасываем: они приходят из платёжных реквизитов. */
function legalName(zone: string): string | undefined {
  for (const re of NAME_PATTERNS) {
    const m = zone.match(re);
    if (!m) continue;
    const value = clean(m[0], 160);
    if (value && !/банк|bank/i.test(value)) return value;
  }
  return undefined;
}

/** Юридический адрес: принимаем, только если в нём есть цифра (индекс или дом). */
function address(zone: string): string | undefined {
  const m = zone.match(
    /(?:юридическ[а-яё]*\s+)?адрес(?:\s+(?:организации|места\s+нахождения|регистрации))?\s*[:\-–]?\s*([^;]{10,200})/i,
  );
  if (!m) return undefined;
  const value = clean(m[1], 200);
  return value && /\d/.test(value) ? value : undefined;
}

/**
 * Обрезает значение по первому «хвостовому» маркеру и снимает мусор по краям: висячие
 * запятые, непарные скобки и кавычки. Именно здесь умирает «(далее – «Заказчик»)».
 */
function clean(value: string, maxLen: number): string {
  let v = value.trim();
  const stop = v.search(VALUE_STOP);
  if (stop > 0) v = v.slice(0, stop);

  v = v.replace(/\s+/g, ' ').trim();
  // Непарные скобки и кавычки: считаем баланс и режем хвост, начиная с лишней открывающей.
  for (const [open, close] of [['(', ')'], ['«', '»']] as const) {
    let depth = 0;
    for (let i = 0; i < v.length; i++) {
      if (v[i] === open) depth++;
      else if (v[i] === close) depth--;
      if (depth < 0) { v = v.slice(0, i); depth = 0; break; }
    }
    if (depth > 0) v = v.slice(0, v.lastIndexOf(open));
  }
  v = v.replace(/^[\s,;:.–—-]+/, '').replace(/[\s,;:–—-]+$/, '').trim();
  return v.length > maxLen ? '' : v;
}
