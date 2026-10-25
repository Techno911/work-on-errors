import * as nodemailer from 'nodemailer';

/** Общий отправитель отчётных писем (weekly-отчёт, расчёт премии РОПа). */
export async function sendReportEmail(to: string[], subject: string, html: string): Promise<void> {
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'localhost',
    port: parseInt(process.env.SMTP_PORT || '25', 10),
    secure: false,
    tls: { rejectUnauthorized: false },
    ...(process.env.SMTP_USER
      ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } }
      : {}),
  });
  // Текстовая версия из html: письма без text-части чаще уходят в спам.
  const text = html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  await transport.sendMail({
    from: `"Работа над ошибками" <${process.env.MAIL_FROM || 'noreply@example.invalid'}>`,
    to: to.join(', '),
    subject,
    html,
    text,
    // List-Unsubscribe убирает спам-штраф SpamAssassin у рассылок и включает
    // «отписаться в один клик» у почтовых клиентов (mail-tester это учитывает).
    headers: {
      'List-Unsubscribe': `<mailto:${process.env.MAIL_FROM || 'noreply@example.invalid'}?subject=unsubscribe>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  });
}
