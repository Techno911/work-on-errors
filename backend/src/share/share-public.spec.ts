import { ShareService } from './share.service';

/**
 * Замок публичной ссылки (разбор 09.08.2026, третий проход по просьбе владельца).
 *
 * По этой ссылке ходит человек БЕЗ учётной записи, и ссылку пересылают дальше. До правки
 * отчёт отдавал расшифровку звонка ровно так, как её вернуло распознавание: с телефонами,
 * почтой и отчествами клиентов. Внутри платформы то же правило уже действовало (доказательства
 * методички чистятся через redactPii), а самый открытый выход данных из системы оставался сырым.
 * На проде на тот момент было 0 выпущенных ссылок, то есть заряжено, но не выстрелило.
 *
 * Проверяем ПОВЕДЕНИЕ отдаваемого HTML, а не наличие вызова в коде: замок, который ищет имя
 * функции, остаётся зелёным, когда вызов убрали, а определение осталось.
 */
describe('публичный отчёт по ссылке', () => {
  // renderHtml приватный: дёргаем через прототип, как это делает сам сервис.
  const render = (entry: Record<string, unknown>): string =>
    (ShareService.prototype as unknown as {
      renderHtml(e: Record<string, unknown>): string;
    }).renderHtml.call({}, entry);

  const base = {
    id: 'e1',
    entryNumber: 7,
    entryDate: '2026-08-01',
    type: 'call',
    source: 'Телефон',
    sourceCustom: null,
    selfReviewCorrect: null,
    selfReviewImprove: null,
    selfReviewSuggestions: null,
    reviewText: null,
    reviewedAt: null,
    transcription: null,
    manager: { fullName: 'Иван Петров' },
    reviewer: { fullName: 'Пётр Сидоров' },
    errorTags: [],
  };

  it('телефон клиента из расшифровки наружу не уходит', () => {
    const html = render({ ...base, transcription: 'Клиент оставил номер +7 926 123-45-67 для связи.' });
    expect(html).not.toContain('926');
    expect(html).toContain('[телефон]');
  });

  it('отчество клиента заменяется подписью', () => {
    const html = render({ ...base, transcription: 'Разговор с Мариной Сергеевной о переносе.' });
    expect(html).not.toContain('Сергеевной');
    expect(html).toContain('[имя клиента]');
  });

  it('почта и номер карты тоже скрыты', () => {
    const html = render({
      ...base,
      reviewText: 'Отправил на client@example.com, оплата картой 4276 3800 1234 5678.',
    });
    expect(html).not.toContain('client@example.com');
    expect(html).not.toContain('4276');
  });

  // Самоанализ менеджера тоже содержит данные клиента: чистится каждое поле, а не только фактура.
  it.each([
    ['selfReviewCorrect', 'Дозвонился по +7 926 111-22-33 с первого раза.'],
    ['selfReviewImprove', 'Забыл записать телефон +7 926 111-22-33 в карточку.'],
    ['selfReviewSuggestions', 'Перезвонить на +7 926 111-22-33 в понедельник.'],
  ])('поле %s тоже чистится', (field, text) => {
    const html = render({ ...base, [field]: text });
    expect(html).not.toContain('111-22-33');
    expect(html).toContain('[телефон]');
  });

  it('страница закрыта от поисковиков', () => {
    const html = render({ ...base, transcription: 'Обычный разговор.' });
    expect(html).toMatch(/<meta name="robots" content="noindex/);
  });

  it('текст без персональных данных остаётся читаемым', () => {
    const html = render({ ...base, transcription: 'Клиент спросил про сроки и стоимость.' });
    expect(html).toContain('Клиент спросил про сроки и стоимость.');
  });
});
