import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, AlertTriangle, ChevronDown, Trash2, RefreshCw, UserPlus, Send, Link as LinkIcon } from 'lucide-react';
import { crmApi } from '@/api/crm';
import { companiesApi } from '@/api/companies';
import { adminApi } from '@/api/admin';
import { CRM_ERROR_TEXTS } from '@/content/crmErrors';
import type { CrmConnectionView, CrmUser, User } from '@/types';
import { CrmConnectWizard, type CrmSubmitDto } from '@/components/crm/CrmConnectWizard';
import { Button, Checkbox, Input, Select, Badge, Notice, Card } from '@chirkov/shell';

// Обобщённые ярлыки-должности, которые в CRM часто заводят как «имя пользователя»
// вместо реального сотрудника (одного клиента: «Ассистент», «ИТР», «Прорабы»).
// Такие записи вряд ли нужно заводить на платформу — уводим их вниз и не выделяем.
const ROLE_LABEL_WORDS = new Set([
  'ассистент', 'итр', 'прораб', 'прорабы', 'оператор', 'бухгалтер', 'бухгалтерия',
  'склад', 'кладовщик', 'снабжение', 'снаб', 'логист', 'логистика', 'водитель',
  'охрана', 'администратор', 'админ', 'сотрудник', 'пользователь', 'test', 'тест',
]);

// «Похоже на живого человека»: есть имя и фамилия (пробел) либо одиночное имя,
// не совпадающее с обобщённым ярлыком-должностью. Такие кандидаты — вероятные
// сотрудники, которых стоит завести; их выделяем и поднимаем наверх.
function looksLikePerson(name: string): boolean {
  const n = name.trim();
  if (n.includes(' ')) return true;
  return n.length >= 4 && !ROLE_LABEL_WORDS.has(n.toLowerCase());
}

/**
 * Подключение CRM (вкладка «Интеграции»). MVP — Битрикс24:
 * owner вставляет URL входящего вебхука целиком, платформа сама проверяет доступ
 * и сопоставляет менеджеров по email.
 */
export function CrmIntegrationSettings({ companyId, transcriptionEnabled, canImportTeam = false, onImported }: {
  companyId: string;
  transcriptionEnabled: boolean;
  canImportTeam?: boolean;
  /** Поднимает наверх созданные учётки (пароли) — родитель показывает их стойко, чтобы не потерялись при уходе с вкладки, и обновляет список команды. */
  onImported?: (result: { created: { name: string; email: string; activationUrl: string }[]; failed: string[] }) => void;
}) {
  const [conn, setConn] = useState<CrmConnectionView | null>(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; accountName?: string; errorCode?: string } | null>(null);
  // Ссылка-поручение администратору CRM клиента (создаётся по кнопке, живёт две недели).
  const [setupUrl, setSetupUrl] = useState<string | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [crmUsers, setCrmUsers] = useState<CrmUser[]>([]);
  const [teamUsers, setTeamUsers] = useState<User[]>([]);
  const [mapBusy, setMapBusy] = useState(false);
  // Итог последнего автосопоставления: остаётся на экране (не исчезает как toast),
  // подсвечивает строки сотрудников, которых не нашли по email.
  const [mapResult, setMapResult] = useState<{ matched: number; unmatched: string[] } | null>(null);
  // Импорт сотрудников из CRM: разворачивается по кнопке, роль на каждого,
  // после создания показывает именные ссылки входа (их отправляют сотрудникам).
  const [importOpen, setImportOpen] = useState(false);
  const [importRoles, setImportRoles] = useState<Record<string, 'manager' | 'reviewer'>>({});
  const [importSel, setImportSel] = useState<Record<string, boolean>>({});
  const [importBusy, setImportBusy] = useState(false);
  // Флаг «импорт уже прошёл» — чтобы эффект умных дефолтов не перетирал выбор после действия.
  // Сами ссылки живут у родителя (onImported), а не тут, иначе теряются при уходе с вкладки.
  const [imported, setImported] = useState(false);

  const loadMappingData = useCallback(async () => {
    try {
      const [{ data: cu }, { data: team }] = await Promise.all([
        crmApi.crmUsers(companyId),
        companiesApi.getUsers(companyId),
      ]);
      setCrmUsers(cu ?? []);
      setTeamUsers((team ?? []).filter((u: User) => u.role === 'manager' || u.role === 'reviewer'));
    } catch { /* подключение могло сломаться — таблица просто не покажется */ }
  }, [companyId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await crmApi.getConnection(companyId);
        if (cancelled) return;
        setConn(data ?? null);
        if (data?.status === 'ok') {
          loadMappingData();
          // Сопоставление по email должно происходить само, без ручного клика:
          // если ещё ни разу не сопоставляли — делаем тихо при первом заходе.
          if (!data.userMap || Object.keys(data.userMap).length === 0) autoMap(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, loadMappingData]);

  // Умные дефолты панели импорта: похожих на людей — выделяем сразу, админов CRM
  // предлагаем как РОПа, остальных как менеджеров. Не трогаем, если импорт уже прошёл
  // (importResult) — чтобы не сбросить выбор пользователя после действия.
  useEffect(() => {
    if (imported) return;
    const already = new Set(teamUsers.map(u => u.email?.toLowerCase()).filter(Boolean));
    const candidates = crmUsers.filter(cu => cu.email && !already.has(cu.email.toLowerCase()));
    if (!candidates.length) return;
    setImportSel(Object.fromEntries(candidates.map(cu => [cu.id, looksLikePerson(cu.name)])));
    setImportRoles(Object.fromEntries(candidates.map(cu => [cu.id, cu.isAdmin ? 'reviewer' : 'manager'])));
  }, [crmUsers, teamUsers, imported]);

  const connect = async (dto: CrmSubmitDto) => {
    setSaving(true);
    setTestResult(null);
    try {
      const { data } = await crmApi.upsert(companyId, dto);
      setConn(data);
      setTestResult(data.test);
      if (data.test.ok) {
        toast.success(`Подключено: ${data.test.accountName}`);
        loadMappingData();
        // Сразу сопоставляем сотрудников по email — пользователю не нужно жать кнопку.
        autoMap(true);
      }
      return data.test;
    } catch (err) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(typeof msg === 'string' && msg.length < 200 ? msg : 'Не удалось сохранить подключение', { duration: Infinity });
      return { ok: false as const };
    } finally {
      setSaving(false);
    }
  };

  /**
   * Ссылка-поручение: вебхук создаётся только внутри портала клиента, и доступа туда у трекера
   * нет. Одна кнопка отправляет администратору всё, что ему нужно, и снимает пересказ инструкции
   * в переписке. Ссылка одноразовая и гаснет, как только CRM подключена.
   */
  const makeSetupLink = async (sendToChat: boolean) => {
    setLinkBusy(true);
    try {
      const { data } = await crmApi.setupLink(companyId, sendToChat);
      setSetupUrl(data.url);
      if (sendToChat) {
        if (data.sentToChat) toast.success('Отправили в рабочий чат команды');
        else toast.error('Рабочий чат не подключён: скопируйте ссылку и отправьте её администратору CRM сами', { duration: Infinity });
      } else {
        try {
          await navigator.clipboard.writeText(data.url);
          toast.success('Ссылка скопирована');
        } catch {
          toast.info('Скопируйте ссылку из поля ниже');
        }
      }
    } catch {
      toast.error('Не удалось создать ссылку. Попробуйте ещё раз.', { duration: Infinity });
    } finally {
      setLinkBusy(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm('Отключить CRM? Менеджеры перестанут видеть кнопку «Из CRM», уже добавленные записи останутся.')) return;
    try {
      await crmApi.remove(companyId);
      setConn(null);
      setCrmUsers([]);
      setTestResult(null);
      setMapResult(null);
      toast.success('CRM отключена');
    } catch {
      toast.error('Не удалось отключить CRM. Попробуйте ещё раз.', { duration: Infinity });
    }
  };

  const testConn = async () => {
    setTesting(true);
    try {
      const { data } = await crmApi.test(companyId);
      setConn(prev => prev ? { ...prev, status: data.ok ? 'ok' : 'error', lastError: data.ok ? null : (data.errorCode ?? 'UNKNOWN') } : prev);
      if (data.ok) {
        toast.success(`Подключение работает${data.accountName ? `: ${data.accountName}` : ''}`);
        loadMappingData();
      } else {
        toast.error(CRM_ERROR_TEXTS[data.errorCode ?? ''] ?? CRM_ERROR_TEXTS.UNKNOWN, { duration: Infinity });
      }
    } catch {
      toast.error('Не удалось проверить подключение', { duration: Infinity });
    } finally {
      setTesting(false);
    }
  };

  // silent — автоматический прогон (при подключении/заходе): без баннера и без тоста ошибки,
  // чтобы сопоставление «просто произошло». Ручной прогон (silent=false) показывает итог.
  const autoMap = async (silent = false) => {
    if (!silent) setMapBusy(true);
    try {
      const { data } = await crmApi.autoMap(companyId);
      setConn(prev => prev ? { ...prev, userMap: data.userMap } : prev);
      if (!silent) setMapResult({ matched: data.matched, unmatched: data.unmatched });
    } catch {
      if (!silent) {
        setMapResult(null);
        toast.error('Не удалось сопоставить автоматически', { duration: Infinity });
      }
    } finally {
      if (!silent) setMapBusy(false);
    }
  };

  // Создаёт учётки платформы из выбранных сотрудников CRM (имя + email из CRM),
  // затем автосопоставляет их по email. Вместо пароля возвращается именная ссылка входа:
  // пароль в переписке живёт дольше, чем нужно, и уходит через третьи руки.
  const importFromCrm = async () => {
    const chosen = crmUsers.filter(cu => importSel[cu.id] && cu.email);
    if (!chosen.length) return;
    setImportBusy(true);
    const created: { name: string; email: string; activationUrl: string }[] = [];
    const failed: string[] = [];
    for (const cu of chosen) {
      try {
        const { data } = await adminApi.createCompanyUser(companyId, {
          fullName: cu.name,
          email: cu.email!,
          role: importRoles[cu.id] ?? 'manager',
        });
        created.push({ name: data.user.fullName, email: data.user.email, activationUrl: data.activationUrl });
      } catch (err) {
        const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
        failed.push(`${cu.name}${typeof msg === 'string' ? ` (${msg})` : ''}`);
      }
    }
    await loadMappingData();
    try {
      const { data } = await crmApi.autoMap(companyId);
      setConn(prev => prev ? { ...prev, userMap: data.userMap } : prev);
    } catch { /* маппинг можно доделать вручную ниже */ }
    // Ссылки входа поднимаем родителю: он покажет их стойким блоком (переживает уход
    // с вкладки) и обновит список «Команда». Если родитель не передан — тост-фолбэк.
    setImported(true);
    setImportSel({});
    setImportOpen(false);
    setImportBusy(false);
    if (onImported) onImported({ created, failed });
    else if (created.length) toast.success(`Добавлено: ${created.length}. Ссылки входа в разделе «Команда» (кнопка «Доступ в чат»).`);
  };

  const setMapping = async (userId: string, crmUserId: string) => {
    const next = { ...(conn?.userMap ?? {}) };
    if (crmUserId) next[userId] = crmUserId;
    else delete next[userId];
    try {
      const { data } = await crmApi.updateMapping(companyId, next);
      setConn(prev => prev ? { ...prev, userMap: data } : prev);
    } catch {
      toast.error('Не удалось сохранить сопоставление', { duration: Infinity });
    }
  };

  if (loading) return <Card padding="md" className="h-32 animate-pulse" />;

  // Менеджеры видят кнопку «Из CRM», только когда подключение в порядке И включена транскрипция:
  // без транскрипции записанный звонок не превращается в текст, и кнопка остаётся скрытой.
  const managersSeeButton = conn?.status === 'ok' && transcriptionEnabled;
  // Сколько сотрудников ещё не сопоставлено с учёткой CRM — каждый из них не видит «Из CRM»
  const unmappedCount = teamUsers.filter(u => !conn?.userMap?.[u.id]).length;
  // Сотрудники CRM, которых ещё нет на платформе (по email) — кандидаты на импорт в команду.
  // Сортировка: сначала похожие на живых людей (вероятные сотрудники), ярлыки-должности — вниз.
  const teamEmails = new Set(teamUsers.map(u => u.email?.toLowerCase()).filter(Boolean));
  const importableCrmUsers = crmUsers
    .filter(cu => cu.email && !teamEmails.has(cu.email.toLowerCase()))
    .sort((a, b) => Number(looksLikePerson(b.name)) - Number(looksLikePerson(a.name)));

  return (
    <Card padding="md" className="space-y-5">
      <div>
        <h2 className="text-body-lg font-semibold text-fg mb-1">CRM: записи звонков одной кнопкой</h2>
        <p className="text-micro text-fg-subtle">
          Подключите Битрикс24 или amoCRM, и менеджеры будут подтягивать записи своих звонков прямо в форму добавления, без скачивания файлов вручную.
        </p>
      </div>

      {!transcriptionEnabled && (
        <Notice tone="warning" title="Сначала включите транскрипцию звонков.">
          Пока транскрипция выключена, кнопка «Из CRM» у менеджеров не появится, даже если подключение в порядке: записанный звонок без транскрипции не превращается в текст. Транскрипция включается выше, в разделе «Транскрипция звонков» (управляет «ЧиП»).
        </Notice>
      )}

      {conn && (
        <Card padding="none" surface="canvas">
          <div className="flex items-start gap-2 px-3 py-2">
            {managersSeeButton
              ? <CheckCircle2 className="w-4 h-4 text-success-fg mt-0.5 flex-shrink-0" />
              : <AlertTriangle className="w-4 h-4 text-warning mt-0.5 flex-shrink-0" />}
            <p className="text-micro text-fg-muted">
              Менеджеры видят кнопку «Из CRM»: <b className="text-fg">{managersSeeButton ? 'да' : 'нет'}</b>
              {!managersSeeButton && (
                <span>: {conn.status !== 'ok' ? 'подключение не в порядке' : 'выключена транскрипция'}.</span>
              )}
              {managersSeeButton && <span>: у каждого, кто сопоставлен с учёткой CRM ниже.</span>}
            </p>
          </div>
        </Card>
      )}

      {conn ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 p-3 rounded-block border" style={{ borderColor: conn.status === 'ok' ? 'var(--color-success-border)' : 'var(--color-danger-border)', backgroundColor: conn.status === 'ok' ? 'var(--color-success-subtle)' : 'var(--color-danger-subtle)' }}>
            <div className="flex items-center gap-2 min-w-0">
              {conn.status === 'ok'
                ? <CheckCircle2 className="w-4 h-4 text-success-fg flex-shrink-0" />
                : <AlertTriangle className="w-4 h-4 text-danger flex-shrink-0" />}
              <div className="min-w-0">
                <p className="text-body font-medium text-fg truncate">
                  {conn.provider === 'amocrm' ? 'amoCRM' : 'Битрикс24'} · {new URL(conn.baseUrl).hostname} · токен {conn.secretMasked}
                </p>
                {conn.status !== 'ok' && conn.lastError && (
                  <p className="text-micro text-danger-fg mt-0.5">{CRM_ERROR_TEXTS[conn.lastError] ?? CRM_ERROR_TEXTS.UNKNOWN}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={testConn}
                disabled={testing}
                icon={<RefreshCw className={testing ? 'animate-spin' : ''} />}
              >
                {testing ? 'Проверяем…' : 'Проверить подключение'}
              </Button>
              <Button variant="ghost" size="sm" type="button" onClick={disconnect} aria-label="Отключить CRM" icon={<Trash2 />} />
            </div>
          </div>

          {conn.status === 'ok' && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <h3 className="text-body font-semibold text-fg">Сопоставление сотрудников</h3>
                  {unmappedCount > 0 && (
                    <Badge tone="warning">{unmappedCount} без сопоставления</Badge>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  onClick={() => autoMap(false)}
                  disabled={mapBusy || teamUsers.length === 0}
                  title="Пересопоставить по email, если добавили сотрудников"
                  icon={<RefreshCw className={mapBusy ? 'animate-spin' : ''} />}
                >
                  {mapBusy ? 'Сопоставляем…' : 'Обновить'}
                </Button>
              </div>
              <p className="text-micro text-fg-subtle mb-3">
                Платформа сама связала сотрудников с их учётками в CRM по email. По нему менеджер в кнопке «Из CRM» видит только свои звонки. Если кого-то не нашла (подсвечен), поправьте вручную ниже.
              </p>
              {mapResult && (
                <div
                  className="flex items-start gap-2 mb-3 px-3 py-2 rounded-block border"
                  style={mapResult.unmatched.length
                    ? { borderColor: 'var(--color-warning-border)', backgroundColor: 'var(--color-warning-subtle)' }
                    : { borderColor: 'var(--color-success-border)', backgroundColor: 'var(--color-success-subtle)' }}
                >
                  {mapResult.unmatched.length
                    ? <AlertTriangle className="w-4 h-4 text-warning mt-0.5 flex-shrink-0" />
                    : <CheckCircle2 className="w-4 h-4 text-success-fg mt-0.5 flex-shrink-0" />}
                  <p className="text-micro text-fg-muted">
                    {mapResult.unmatched.length ? (
                      <>
                        Сопоставлено по email: <b className="text-fg">{mapResult.matched}</b>. Не нашлись: <b className="text-fg">{mapResult.unmatched.join(', ')}</b>. Выберите учётку CRM вручную в подсвеченных строках ниже.
                      </>
                    ) : (
                      <>Сопоставлены все сотрудники: <b className="text-fg">{mapResult.matched}</b>.</>
                    )}
                  </p>
                </div>
              )}
              <div className="space-y-2">
                {teamUsers.map(u => {
                  const highlight = Boolean(mapResult?.unmatched.length) && !conn.userMap?.[u.id];
                  return (
                  <div
                    key={u.id}
                    className="flex items-center gap-3 rounded-card"
                    style={highlight ? { backgroundColor: 'var(--color-warning-subtle)', boxShadow: '0 0 0 1px var(--color-warning-border)', padding: '4px 8px' } : undefined}
                  >
                    <span className="text-body text-fg-muted flex-1 min-w-0 truncate">{u.fullName}</span>
                    <div className="w-56 flex-shrink-0">
                      <Select
                        value={conn.userMap?.[u.id] ?? ''}
                        onChange={e => setMapping(u.id, e.target.value)}
                        aria-label={`Учётка CRM для ${u.fullName}`}
                      >
                        <option value="">не сопоставлен</option>
                        {crmUsers.map(cu => (
                          <option key={cu.id} value={cu.id}>{cu.name}{cu.email ? ` (${cu.email})` : ''}</option>
                        ))}
                      </Select>
                    </div>
                  </div>
                  );
                })}
                {teamUsers.length === 0 && (
                  <Notice tone="warning" title="В команде пока нет сотрудников">
                    {canImportTeam && importableCrmUsers.length > 0
                      ? 'Добавьте их прямо из CRM ниже: платформа заведёт учётки и сама свяжет со звонками.'
                      : 'Добавьте менеджеров и РОПа на вкладке «Команда». Здесь появится их сопоставление со звонками CRM.'}
                  </Notice>
                )}
              </div>

              {/* Импорт команды из CRM: сотрудники CRM, которых ещё нет на платформе (#5).
                  Создание учёток — эндпоинт суперадмина, поэтому панель только трекеру. */}
              {canImportTeam && importableCrmUsers.length > 0 && (
                <div className="mt-3 rounded-block border border-border overflow-hidden">
                  <Button
                    variant="ghost"
                    size="md"
                    fullWidth
                    type="button"
                    onClick={() => setImportOpen(o => !o)}
                    icon={<UserPlus className="text-accent" />}
                  >
                    <span className="flex items-center justify-between gap-2 w-full text-body font-medium text-fg-muted">
                      <span className="flex items-center gap-2">
                        Добавить сотрудников из CRM
                        <Badge tone="accent">{importableCrmUsers.length}</Badge>
                      </span>
                      <ChevronDown className={`w-4 h-4 text-fg-subtle transition-transform ${importOpen ? 'rotate-180' : ''}`} />
                    </span>
                  </Button>
                  {importOpen && (
                    <div className="p-3.5 space-y-2 border-t border-border">
                      <p className="text-micro text-fg-subtle">
                        Платформа заведёт учётки с этими именами и email из CRM, выдаст пароли и сразу свяжет каждого с его звонками. Похожие на сотрудников уже отмечены и подняты наверх; администраторы CRM предложены как РОП. Проверьте роли и снимите лишних. Собственнику останется подтвердить согласие на аккаунты команды.
                      </p>
                      {importableCrmUsers.map(cu => {
                        const person = looksLikePerson(cu.name);
                        return (
                        <div key={cu.id} className={`flex items-center gap-2.5 ${person ? '' : 'opacity-55'}`}>
                          <div className="flex-1 min-w-0">
                            <Checkbox
                              checked={Boolean(importSel[cu.id])}
                              onChange={e => setImportSel(s => ({ ...s, [cu.id]: e.target.checked }))}
                              label={
                                <span className="truncate flex items-center gap-1.5">
                                  <span className="truncate">{cu.name} <span className="text-fg-subtle text-micro">{cu.email}</span></span>
                                  {cu.isAdmin && (
                                    <Badge tone="accent">админ CRM</Badge>
                                  )}
                                  {!person && (
                                    <Badge tone="neutral">похоже на должность</Badge>
                                  )}
                                </span>
                              }
                            />
                          </div>
                          <div className="w-32 flex-shrink-0">
                            <Select
                              value={importRoles[cu.id] ?? 'manager'}
                              onChange={e => setImportRoles(r => ({ ...r, [cu.id]: e.target.value as 'manager' | 'reviewer' }))}
                              aria-label={`Роль для ${cu.name}`}
                            >
                              <option value="manager">Менеджер</option>
                              <option value="reviewer">РОП</option>
                            </Select>
                          </div>
                        </div>
                        );
                      })}
                      <Button
                        variant="primary"
                        size="md"
                        type="button"
                        onClick={importFromCrm}
                        disabled={importBusy || !Object.values(importSel).some(Boolean)}
                        icon={<UserPlus />}
                      >
                        {importBusy ? 'Добавляем…' : `Добавить выбранных (${Object.values(importSel).filter(Boolean).length})`}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {/* Доступ к порталу CRM есть только у клиента: подключение делегируется одной кнопкой,
              а не пересказом инструкции в переписке. Поэтому этот блок стоит первым. */}
          <div className="rounded-block border border-border p-4">
            <p className="text-body font-semibold text-fg">Поручить администратору CRM</p>
            <p className="text-micro text-fg-subtle mt-1">
              Вебхук создаётся внутри портала клиента, и доступ туда есть только у него. Отправьте ссылку тому,
              у кого права администратора: он пройдёт три шага у себя, без входа в платформу. Ссылка одноразовая,
              действует две недели, гаснет сразу после подключения. Вы получите уведомление.
            </p>
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <Button
                variant="primary"
                size="md"
                type="button"
                onClick={() => makeSetupLink(true)}
                disabled={linkBusy}
                icon={<Send />}
              >
                {linkBusy ? 'Готовим…' : 'Отправить в рабочий чат'}
              </Button>
              <Button variant="secondary" size="md"
                type="button"
                onClick={() => makeSetupLink(false)}
                disabled={linkBusy}
                icon={<LinkIcon />}
              >
                Скопировать ссылку
              </Button>
            </div>
            {setupUrl && (
              <div className="mt-2">
                <Input font="mono"
                  readOnly
                  value={setupUrl}
                  onFocus={e => e.currentTarget.select()}
                  aria-label="Ссылка-поручение на подключение CRM"
                />
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <span className="flex-1 h-px bg-border" />
            <span className="text-micro text-fg-subtle">или подключите сами, если доступ к порталу у вас есть</span>
            <span className="flex-1 h-px bg-border" />
          </div>

          <CrmConnectWizard onSubmit={connect} submitting={saving} />
          {testResult && !testResult.ok && (
            <p className="text-micro text-danger-fg">{CRM_ERROR_TEXTS[testResult.errorCode ?? ''] ?? CRM_ERROR_TEXTS.UNKNOWN}</p>
          )}
        </div>
      )}
    </Card>
  );
}
