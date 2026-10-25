import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import { crmApi } from '@/api/crm';
import { Card } from '@chirkov/shell';
import { CrmConnectWizard, type CrmSubmitDto } from '@/components/crm/CrmConnectWizard';

/**
 * Публичная страница подключения CRM по ссылке-поручению (/crm-setup/:token).
 * Открывает её администратор портала клиента: учётки в платформе у него нет и не нужно.
 * Он видит только название своей компании и шаги подключения, никаких данных платформы.
 */
export function CrmSetupPage() {
  const { token } = useParams<{ token: string }>();
  const [companyName, setCompanyName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ accountName?: string } | null>(null);

  useEffect(() => {
    if (!token) return;
    crmApi.setupInfo(token)
      .then(({ data }) => {
        setCompanyName(data.companyName);
        if (data.alreadyConnected) setDone({});
      })
      .catch((err) => setError(
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message
        ?? 'Ссылка недействительна. Запросите новую у вашего трекера «ЧиП».',
      ))
      .finally(() => setLoading(false));
  }, [token]);

  const needHelp = async () => {
    if (!token) return;
    try {
      await crmApi.setupHelp(token);
    } catch { /* сигнал best-effort: человеку всё равно скажем, что мы на связи */ }
  };

  const submit = async (dto: CrmSubmitDto) => {
    if (!token) return { ok: false };
    setSubmitting(true);
    try {
      const { data } = await crmApi.setupSubmit(token, dto);
      if (data.ok) setDone({ accountName: data.accountName });
      return data;
    } catch (err) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      return { ok: false as const, errorCode: undefined, message: msg };
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-canvas py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <p className="text-body font-semibold text-fg mb-6">Работа над ошибками</p>

        {loading && <Card padding="md" className="h-64 animate-pulse" />}

        {!loading && error && (
          <Card padding="md" className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-danger mt-0.5 flex-shrink-0" />
            <div>
              <h1 className="text-title font-semibold text-fg">Ссылка не открывается</h1>
              <p className="text-body text-fg-muted mt-1">{error}</p>
            </div>
          </Card>
        )}

        {!loading && !error && done && (
          <Card padding="md" className="flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-success-fg mt-0.5 flex-shrink-0" />
            <div>
              <h1 className="text-title font-semibold text-fg">
                CRM подключена{done.accountName ? `: ${done.accountName}` : ''}
              </h1>
              <p className="text-body text-fg-muted mt-1">
                Спасибо, дальше всё делаем мы. Что будет теперь: платформа свяжет ваших сотрудников с их учётками в CRM,
                у менеджеров появится кнопка «Из CRM», и записи звонков они будут добавлять в один клик, без скачивания файлов.
                Трекер «ЧиП» уже получил сигнал и допроверит настройку. Эту страницу можно закрыть.
              </p>
            </div>
          </Card>
        )}

        {!loading && !error && !done && (
          <Card padding="md" className="space-y-5">
            <div>
              <h1 className="text-title font-semibold text-fg">Подключение CRM компании «{companyName}»</h1>
              <p className="text-body text-fg-subtle mt-1">
                Ваша команда работает в платформе «Работа над ошибками»: разбирает записи звонков и делает выводы.
                Чтобы записи подтягивались из CRM сами, нужен доступ на чтение звонков. Это займёт пару минут,
                делается один раз и требует прав администратора портала.
              </p>
            </div>
            <CrmConnectWizard onSubmit={submit} submitting={submitting} onNeedHelp={needHelp} />
          </Card>
        )}

        <p className="text-micro text-fg-subtle mt-4">
          Ссылку прислал ваш трекер «Чирков и партнёры». Платформа читает записи звонков и список сотрудников,
          ничего не изменяет в вашей CRM и не передаёт данные третьим лицам.
        </p>
      </div>
    </div>
  );
}
