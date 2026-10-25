import { useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Copy, ExternalLink, Plug, Check, HelpCircle, ChevronDown } from 'lucide-react';
import { CRM_ERROR_TEXTS } from '@/content/crmErrors';
import { B24_MARKETPLACE_NAME, B24_MARKETPLACE_PRICE, B24_MARKETPLACE_WHERE } from '@/content/crmPrerequisites';
import { Button, ButtonLink, Checkbox, Input, Tabs } from '@chirkov/shell';

export type CrmProvider = 'bitrix24' | 'amocrm';
export type CrmSubmitDto = { provider: CrmProvider; webhookUrl?: string; baseUrl?: string; secret?: string };

/** Права вебхука, без которых интеграция не работает. Копируются одной кнопкой. */
const B24_SCOPES = 'crm, telephony, user, disk';

/**
 * Мастер подключения CRM: одна и та же последовательность и в кабинете (трекер/владелец),
 * и на публичной странице для администратора CRM клиента. Именно один компонент, а не две
 * копии: инструкция к подключению обязана быть одна, иначе версии разъедутся молча.
 *
 * Порядок шагов — не косметика. Условие, без которого вся работа впустую (подписка Битрикса,
 * права администратора), стоит ПЕРВЫМ и требует явной отметки: человек, узнавший о нём внизу
 * страницы, уже потратил время зря и должен переделывать. Дальше каждый шаг — одно действие,
 * платформа сама открывает нужный раздел ЕГО портала и отдаёт права в буфер обмена.
 * Читатель обычно РОП или собственник, не технический специалист.
 */
export function CrmConnectWizard({ onSubmit, submitting, onNeedHelp }: {
  onSubmit: (dto: CrmSubmitDto) => Promise<{ ok: boolean; errorCode?: string } | void>;
  submitting: boolean;
  /** Кнопка «не получается» — зовёт трекера. Без неё человек упирается в тупик молча. */
  onNeedHelp?: () => Promise<void> | void;
}) {
  const [provider, setProvider] = useState<CrmProvider>('bitrix24');
  const [isAdmin, setIsAdmin] = useState(false);
  const [subscriptionOk, setSubscriptionOk] = useState(false);
  const [portal, setPortal] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [amoToken, setAmoToken] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [helpSent, setHelpSent] = useState(false);

  // Адрес портала: принимаем в любом виде, в том числе ссылку целиком из адресной строки.
  const host = portal.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
  const hostOk = provider === 'bitrix24'
    ? /\.bitrix24\.[a-z]{2,3}$/.test(host)
    : /\.(amocrm\.(ru|com)|kommo\.com)$/.test(host);

  // Предусловия: у amoCRM подписки Маркетплейса нет, там достаточно прав администратора.
  const ready = isAdmin && (provider === 'amocrm' || subscriptionOk);

  // Из вставленного вебхука адрес портала виден сам — подставляем, чтобы шаг не переспрашивал.
  const onWebhookChange = (value: string) => {
    setWebhookUrl(value);
    const m = value.trim().match(/^https?:\/\/([^/]+\.bitrix24\.[a-z]{2,3})\//i);
    if (m && !portal.trim()) setPortal(m[1]);
  };

  const copyScopes = async () => {
    try {
      await navigator.clipboard.writeText(B24_SCOPES);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Браузер не дал доступ к буферу обмена. Отметьте права вручную: ' + B24_SCOPES, { duration: Infinity });
    }
  };

  const submit = async () => {
    setError(null);
    const dto: CrmSubmitDto = provider === 'bitrix24'
      ? { provider, webhookUrl: webhookUrl.trim() }
      : { provider, baseUrl: host, secret: amoToken.trim() };
    const res = await onSubmit(dto);
    if (res && !res.ok) setError(CRM_ERROR_TEXTS[res.errorCode ?? ''] ?? CRM_ERROR_TEXTS.UNKNOWN);
  };

  const callHelp = async () => {
    if (!onNeedHelp) return;
    await onNeedHelp();
    setHelpSent(true);
  };

  const canSubmit = provider === 'bitrix24'
    ? webhookUrl.trim().length > 20
    : hostOk && amoToken.trim().length > 10;

  return (
    <div className="space-y-4">
      <Tabs value={provider} onValueChange={(key) => { setProvider(key as typeof provider); setError(null); }}>
        <Tabs.List ariaLabel="CRM-система">
          <Tabs.Tab value="bitrix24">Битрикс24</Tabs.Tab>
          <Tabs.Tab value="amocrm">amoCRM</Tabs.Tab>
        </Tabs.List>
      </Tabs>

      {/* Шаг 1 — предусловия. Стоит первым сознательно: без них шаги 2-4 бессмысленны. */}
      <Step n={1} title="Проверьте два условия перед началом">
        <div className="space-y-2.5">
          <Condition
            checked={isAdmin}
            onChange={setIsAdmin}
            label={provider === 'bitrix24' ? 'Я захожу в Битрикс24 под администратором портала' : 'Я захожу в amoCRM под администратором аккаунта'}
            hint={provider === 'bitrix24'
              ? 'У обычного сотрудника раздела «Разработчикам» нет. Ключ лучше создавать под учёткой собственника: он перестаёт работать, если создателя отключат от портала.'
              : 'Создать интеграцию может только администратор аккаунта. Ключ живёт, пока активна учётка, под которой он создан.'}
          />
          {provider === 'bitrix24' && (
            <Condition
              checked={subscriptionOk}
              onChange={setSubscriptionOk}
              label={`В Битрикс24 активна подписка ${B24_MARKETPLACE_NAME}`}
              hint={`Это главное условие, и проверить его нужно ДО остальных шагов: без подписки портал не отдаёт записи звонков, и подключение упрётся в ошибку на последнем шаге. Смотреть в Битрикс24: ${B24_MARKETPLACE_WHERE}. Стоит ${B24_MARKETPLACE_PRICE}, оплачивается в Битрикс24, у платформы к этому доступа нет.`}
              danger
            />
          )}
        </div>
        {!ready && (
          <p className="text-micro text-fg-subtle mt-2.5">
            Отметьте {provider === 'bitrix24' ? 'оба пункта' : 'пункт'}, чтобы открыть следующие шаги. Если условие не выполнено, продолжать не стоит: подключение всё равно не заработает.
          </p>
        )}
      </Step>

      <div className={ready ? 'space-y-4' : 'space-y-4 opacity-40 pointer-events-none select-none'} aria-disabled={!ready}>
        <Step n={2} title={provider === 'bitrix24' ? 'Откройте раздел «Разработчикам» в своём Битрикс24' : 'Откройте свой аккаунт amoCRM'}>
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="flex-1 min-w-0">
              <Input font="mono"
                type="text"
                autoComplete="off"
                value={portal}
                onChange={e => setPortal(e.target.value)}
                aria-label="Адрес портала"
                placeholder={provider === 'bitrix24' ? 'ваш-портал.bitrix24.ru' : 'ваш-аккаунт.amocrm.ru'}
              />
            </div>
            <ButtonLink
              href={hostOk ? (provider === 'bitrix24' ? `https://${host}/devops/` : `https://${host}/`) : undefined}
              target="_blank"
              rel="noopener noreferrer"
              aria-disabled={!hostOk}
              onClick={e => { if (!hostOk) e.preventDefault(); }}
              variant={hostOk ? 'primary' : 'secondary'}
              icon={<ExternalLink />}
            >
              Открыть
            </ButtonLink>
          </div>
          <p className="text-micro text-fg-subtle mt-1.5">
            Адрес видно в строке браузера, когда вы работаете в CRM: например <span className="font-mono">mycompany.{provider === 'bitrix24' ? 'bitrix24.ru' : 'amocrm.ru'}</span>. Кнопка откроет нужный раздел в новой вкладке, эта страница останется.
          </p>
          {provider === 'bitrix24' && (
            <Details summary="Раздел не открылся?">
              Найдите его вручную: в левом меню Битрикс24 пункт <b>«Приложения»</b>, внутри <b>«Разработчикам»</b>.
              Если пункта нет совсем, вы зашли не под администратором портала: попросите доступ у того, кто им управляет,
              или передайте эту страницу ему.
            </Details>
          )}
        </Step>

        {provider === 'bitrix24' ? (
          <Step n={3} title="Создайте входящий вебхук и отметьте четыре права">
            <p className="text-body text-fg-muted">
              На открывшейся странице выберите <b>«Другое»</b>, затем <b>«Входящий вебхук»</b>. Появится список прав доступа: отметьте эти четыре.
            </p>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <code className="flex-1 min-w-0 basis-48 break-all px-3 py-2 rounded-card bg-canvas border border-border text-body font-mono text-fg-muted">{B24_SCOPES}</code>
              <Button variant="secondary" size="md"
                type="button"
                onClick={copyScopes}
                icon={copied ? <Check /> : <Copy />}
              >
                {copied ? 'Скопировано' : 'Копировать'}
              </Button>
            </div>
            <p className="text-micro text-fg-subtle mt-1.5">
              В списке они называются «CRM», «Телефония», «Пользователи (базовый)» и «Диск». Это доступ к звонкам, сотрудникам и файлам записей: платформа только читает их и ничего не меняет в вашей CRM. Нажмите «Сохранить».
            </p>
            <Details summary="Нет нужных прав">
              Список прав длинный, у него есть поиск. Названия могут отличаться словом: ищите «Телефония» (telephony),
              «Пользователи» (user), «Диск» (disk), «CRM» (crm). Если какого-то права нет вообще, чаще всего дело в тарифе
              портала: см. условие о подписке в первом шаге.
            </Details>
          </Step>
        ) : (
          <Step n={3} title="Создайте интеграцию и сгенерируйте долгосрочный токен">
            <p className="text-body text-fg-muted">
              В аккаунте откройте <b>амоМаркет</b>, затем <b>«Создать интеграцию»</b> (внешняя, название любое, например «Работа над ошибками»).
              В созданной интеграции перейдите на вкладку <b>«Ключи и доступы»</b> и нажмите <b>«Сгенерировать долгосрочный токен»</b>, срок берите максимальный.
            </p>
            <p className="text-micro text-fg-subtle mt-1.5">
              Скопируйте токен сразу: amoCRM показывает его один раз. Если окно закрылось, сгенерируйте новый, старый можно удалить.
            </p>
          </Step>
        )}

        <Step n={4} title={provider === 'bitrix24' ? 'Вставьте сюда ссылку вебхука' : 'Вставьте сюда токен'}>
          {provider === 'bitrix24' ? (
            <>
              <Input font="mono"
                type="text"
                autoComplete="off"
                name="b24-webhook-url"
                value={webhookUrl}
                onChange={e => onWebhookChange(e.target.value)}
                aria-label="URL входящего вебхука Битрикс24"
                placeholder="https://ваш-портал.bitrix24.ru/rest/1/код-вебхука/"
              />
              <p className="text-micro text-fg-subtle mt-1.5">
                После сохранения Битрикс24 покажет строку вида <span className="font-mono">https://<wbr />ваш-портал.<wbr />bitrix24.ru/<wbr />rest/<wbr />1/<wbr />abc123def/</span>. Скопируйте её целиком, вместе с кодом в конце.
              </p>
            </>
          ) : (
            <Input font="mono"
              type="password"
              autoComplete="new-password"
              name="amo-long-lived-token"
              value={amoToken}
              onChange={e => setAmoToken(e.target.value)}
              aria-label="Долгосрочный токен amoCRM"
              placeholder="долгосрочный токен"
            />
          )}
          <div className="mt-2">
            <Button
              variant="primary"
              size="md"
              type="button"
              onClick={submit}
              disabled={submitting || !canSubmit}
              icon={<Plug />}
            >
              {submitting ? 'Проверяем…' : 'Подключить'}
            </Button>
          </div>
          <p className="text-micro text-fg-subtle mt-1.5">
            Платформа сразу проверит доступ и скажет, всё ли в порядке. Ключ хранится в зашифрованном виде, целиком его больше никто не увидит.
          </p>
        </Step>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-block border border-danger-border bg-danger-subtle">
          <AlertTriangle className="w-4 h-4 text-danger mt-0.5 flex-shrink-0" />
          <p className="text-micro text-fg-muted">{error}</p>
        </div>
      )}

      {onNeedHelp && (
        <div className="flex items-start gap-2 pt-1">
          <HelpCircle className="w-4 h-4 text-fg-disabled mt-0.5 flex-shrink-0" />
          <p className="text-micro text-fg-subtle">
            {helpSent ? (
              <>Мы получили сигнал и свяжемся с вами. Страницу можно закрыть, ссылка останется рабочей.</>
            ) : (
              <>
                Что-то не сходится или не хватает прав?{' '}
                <Button variant="link" size="sm" type="button" onClick={callHelp}>
                  Позовите нас на помощь
                </Button>
                {' '}· мы поможем и подключим вместе, ничего страшного не произошло.
              </>
            )}
          </p>
        </div>
      )}
    </div>
  );
}

/** Пункт предусловия: отметка + разъяснение, зачем это и что будет, если условия нет. */
function Condition({ checked, onChange, label, hint, danger }: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint: string;
  danger?: boolean;
}) {
  return (
    <div
      className="p-3 rounded-block border transition-colors"
      style={checked
        ? { borderColor: 'var(--color-success-border)', backgroundColor: 'var(--color-success-subtle)' }
        : danger
          ? { borderColor: 'var(--color-warning-border)', backgroundColor: 'var(--color-warning-subtle)' }
          : { borderColor: 'var(--color-border)' }}
    >
      <Checkbox
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        label={label}
        description={hint}
      />
    </div>
  );
}

/** Подсказка на случай «у меня выглядит не так»: свёрнута, чтобы не мешать тем, у кого всё идёт. */
function Details({ summary, children }: { summary: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <Button
        variant="ghost"
        size="md"
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        icon={<ChevronDown className={`transition-transform ${open ? 'rotate-180' : ''}`} />}
      >
        {summary}
      </Button>
      {open && <p className="text-micro text-fg-muted mt-1.5 pl-4.5">{children}</p>}
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-inverse-hover text-on-inverse text-micro font-semibold flex items-center justify-center mt-0.5">{n}</span>
      <div className="flex-1 min-w-0">
        <p className="text-body font-semibold text-fg mb-1.5">{title}</p>
        {children}
      </div>
    </div>
  );
}
