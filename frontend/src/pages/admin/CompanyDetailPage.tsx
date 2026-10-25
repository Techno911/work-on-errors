import { useEffect, useState } from 'react';
import { PageTitle } from '@/components/layout/PageTitle';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, LayoutDashboard, BarChart3, Plus, RotateCcw, Copy, Check, Settings, Lock, Eye, Trash2, CheckCircle2, Circle, ChevronRight, ExternalLink, MessageSquare, Rocket } from 'lucide-react';
import { crmApi } from '@/api/crm';
import { B24_MARKETPLACE_NAME, B24_MARKETPLACE_PRICE } from '@/content/crmPrerequisites';
import { useAuthStore } from '@/stores/authStore';
import { adminApi, type AdminUser, type LegalInfo, type CompanyStatus } from '@/api/admin';
import type { AdminCompanyDetails, CompanyEventItem } from '@/api/admin';
import { CompanyStatusBadge, COMPANY_STATUS_META, COMPANY_STATUS_ORDER } from '@/components/admin/CompanyStatusBadge';
import { cn } from '@/lib/utils';
import { StaffSummary } from '@/components/admin/StaffSummary';
import { NormPresetPicker } from '@/components/admin/NormPresetPicker';
import { Avatar, Button, Input, Select, Textarea, Badge, Notice, Card, Modal, FileField } from '@chirkov/shell';

const ROLE_LABELS: Record<string, string> = {
  manager: 'Менеджер',
  reviewer: 'РОП',
  owner: 'Владелец',
  superadmin: 'Суперадмин',
  tracker: 'Трекер',
};

const ROLE_BADGE_CONFIG = {
  manager: { tone: 'accent' },
  reviewer: { tone: 'accent' },
  owner: { tone: 'neutral' },
  superadmin: { tone: 'neutral' },
  tracker: { tone: 'success' },
} as const;

const DEFAULT_ROLE_BADGE_CONFIG = ROLE_BADGE_CONFIG.superadmin;

const COMPUTED_HEALTH_BADGE_CONFIG = {
  running: { tone: 'success' },
  ramping: { tone: 'accent' },
  lagging: { tone: 'warning' },
  silent: { tone: 'danger' },
  not_started: { tone: 'danger' },
} as const;

// ── Именная ссылка первого входа ───────────────────────────────────────────
// Пароль показывался один раз в открытой вкладке и терялся при перезагрузке — это прямо
// провоцировало копировать его в переписку. Ссылку можно выслать в чат кнопкой и выпустить
// заново, поэтому терять её не страшно.
function AccessLinkBadge({ url, onDismiss }: { url: string; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Не удалось скопировать', { duration: Infinity });
    }
  };

  return (
    <div className="flex items-center gap-2 bg-success-subtle border border-success-border rounded-card px-3 py-1.5">
      <span className="text-micro text-success-fg">Ссылка входа (3 дня):</span>
      <code className="text-micro font-mono font-semibold text-success-fg bg-success-subtle px-1.5 py-0.5 rounded-chip truncate max-w-[260px]">
        {url}
      </code>
      <Button
        type="button"
        onClick={handleCopy}
        variant="ghost"
        size="sm"
        title="Скопировать"
        icon={copied ? <Check /> : <Copy />}
      />
      <Button
        type="button"
        onClick={onDismiss}
        variant="ghost"
        size="sm"
        title="Скрыть"
      >
        ✕
      </Button>
    </div>
  );
}

// ── Add User Form ──────────────────────────────────────────────────────────
interface AddUserFormProps {
  companyId: string;
  onSuccess: (user: AdminUser, activationUrl: string) => void;
  onCancel: () => void;
}

function AddUserForm({ companyId, onSuccess, onCancel }: AddUserFormProps) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('manager');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim() || !email.trim()) return;
    setLoading(true);
    try {
      const { data } = await adminApi.createCompanyUser(companyId, {
        fullName: fullName.trim(),
        email: email.trim().toLowerCase(),
        role,
      });
      toast.success('Сотрудник добавлен. Отправьте ему именную ссылку входа');
      onSuccess(data.user, data.activationUrl);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e?.response?.data?.message ?? 'Не удалось добавить пользователя', { duration: Infinity });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-accent-subtle border border-accent-muted rounded-block p-4 space-y-3"
    >
      <h3 className="text-body font-semibold text-fg">Новый пользователь</h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-micro font-medium text-fg-muted mb-1">Имя и фамилия</label>
          <Input
            type="text"
            value={fullName}
            onChange={e => setFullName(e.target.value)}
            placeholder="Иван Иванов"
            required
          />
        </div>
        <div>
          <label className="block text-micro font-medium text-fg-muted mb-1">Email</label>
          <Input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="ivan@example.invalid"
            required
          />
        </div>
        <div>
          <label className="block text-micro font-medium text-fg-muted mb-1">Роль</label>
          <Select
            value={role}
            onChange={e => setRole(e.target.value)}
            aria-label="Роль сотрудника"
          >
            <option value="manager">Менеджер</option>
            <option value="reviewer">РОП</option>
            <option value="owner">Владелец</option>
          </Select>
        </div>
      </div>
      <div className="flex gap-2">
        <Button
          type="submit"
          disabled={loading || !fullName.trim() || !email.trim()}
        >
          {loading ? 'Добавляем…' : '+ Добавить'}
        </Button>
        <Button variant="ghost" size="md"
          type="button"
          onClick={onCancel}
        >
          Отмена
        </Button>
      </div>
    </form>
  );
}

// Подсветка «этот чат — ваш»: ранжируем обнаруженные чаты по похожести заголовка
// на название компании (из карточки или реквизитов договора). Совпавшие — наверх,
// лучший помечается флагом isLikely. Без внешних либ: нормализуем и сравниваем токены.
type DetectedChat = { chatId: string; title: string | null; isAdmin: boolean };
function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[«»"'`]/g, '').replace(/[^a-zа-яё0-9]+/gi, ' ').trim();
}
function nameOverlapScore(chatTitle: string | null, companyNames: string[]): number {
  if (!chatTitle) return 0;
  const title = normalizeName(chatTitle);
  if (!title) return 0;
  const titleTokens = new Set(title.split(' ').filter(t => t.length >= 3));
  let best = 0;
  for (const raw of companyNames) {
    const name = normalizeName(raw);
    if (!name) continue;
    if (title.includes(name) || name.includes(title)) { best = Math.max(best, 100); continue; }
    const nameTokens = name.split(' ').filter(t => t.length >= 3);
    const hits = nameTokens.filter(t => titleTokens.has(t)).length;
    if (nameTokens.length) best = Math.max(best, Math.round((hits / nameTokens.length) * 90));
  }
  return best;
}
function rankDetectedChats(chats: DetectedChat[], companyNames: string[]): Array<DetectedChat & { isLikely: boolean }> {
  const scored = chats.map(c => ({ chat: c, score: nameOverlapScore(c.title, companyNames) }));
  scored.sort((a, b) => b.score - a.score);
  const topScore = scored[0]?.score ?? 0;
  return scored.map(({ chat, score }) => ({ ...chat, isLikely: score >= 40 && score === topScore }));
}

// ── Main Page ──────────────────────────────────────────────────────────────
// ── Договор и реквизиты заказчика ──────────────────────────────────────────
// Заказчик в оферте — юрлицо/ИП (из договора), а не бренд. Эти реквизиты подставляются
// в оферту; сюда же трекер загружает файл договора.
const LEGAL_FIELDS: Array<{ key: keyof Pick<LegalInfo, 'legalName' | 'inn' | 'kpp' | 'ogrn' | 'address' | 'signatory'>; label: string; placeholder: string; wide?: boolean }> = [
  { key: 'legalName', label: 'Наименование юрлица / ИП', placeholder: 'ООО «Ромашка» или ИП Иванов Иван Иванович', wide: true },
  { key: 'inn', label: 'ИНН', placeholder: '7701234567' },
  { key: 'kpp', label: 'КПП (у ИП нет)', placeholder: '770101001' },
  { key: 'ogrn', label: 'ОГРН / ОГРНИП', placeholder: '1027700000000' },
  { key: 'signatory', label: 'Подписант', placeholder: 'в лице ген. директора …, действующего на основании устава' },
  { key: 'address', label: 'Юридический адрес', placeholder: '101000, г. Москва, ул. …', wide: true },
];

function LegalInfoSection({ companyId, legalInfo, onSaved }: { companyId: string; legalInfo?: LegalInfo; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState<LegalInfo>(legalInfo ?? {});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // Синхронизируем локальную форму, когда данные компании перезагрузились (напр. после загрузки договора).
  useEffect(() => { setForm(legalInfo ?? {}); }, [legalInfo]);

  const dirty = LEGAL_FIELDS.some(f => (form[f.key] ?? '') !== (legalInfo?.[f.key] ?? ''));

  const save = async () => {
    setSaving(true);
    try {
      await adminApi.saveLegalInfo(companyId, {
        legalName: form.legalName ?? '', inn: form.inn ?? '', kpp: form.kpp ?? '',
        ogrn: form.ogrn ?? '', address: form.address ?? '', signatory: form.signatory ?? '',
      });
      toast.success('Реквизиты сохранены');
      await onSaved();
    } catch {
      toast.error('Не удалось сохранить реквизиты');
    } finally {
      setSaving(false);
    }
  };

  const ACCEPT = ['.doc', '.docx', '.pdf', '.rtf'];
  const upload = async (file: File) => {
    const ext = ('.' + (file.name.split('.').pop() ?? '')).toLowerCase();
    if (!ACCEPT.includes(ext)) {
      toast.error('Договор: файл Word (.doc/.docx), PDF или RTF');
      return;
    }
    setUploading(true);
    try {
      const { data } = await adminApi.uploadContract(companyId, file);
      // Автозаполнение реквизитов из PDF/Word: считаем, сколько полей распозналось.
      const filled = (['legalName', 'inn', 'kpp', 'ogrn', 'address', 'signatory'] as const)
        .filter(k => data.legalInfo?.[k]).length;
      toast.success(filled ? `Договор загружен. Распознано реквизитов: ${filled} (проверьте)` : 'Договор загружен');
      await onSaved();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e?.response?.data?.message ?? 'Не удалось загрузить договор');
    } finally {
      setUploading(false);
    }
  };

  const download = async () => {
    setDownloading(true);
    try {
      const { data } = await adminApi.getContractBlob(companyId);
      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = legalInfo?.contractFileName ?? 'Договор';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Не удалось скачать договор');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div>
      <p className="text-body text-fg-muted my-2">Заказчик в оферте: юрлицо или ИП из договора, а не бренд. Загрузите договор: реквизиты подтянутся и подставятся в оферту.</p>

      {/* Договор: файл на сервере показывает FileField пакета (имя, дата, «Скачать», «Заменить»); реквизиты подтянутся из PDF/Word автоматически. */}
      <div className="mb-4">
        <FileField
          label="Договор"
          hint="PDF или Word. Реквизиты подтянутся автоматически."
          accept=".doc,.docx,.pdf,.rtf"
          disabled={uploading}
          onFileChange={(f) => { if (f) upload(f); }}
          storedFile={legalInfo?.contractFileName ? {
            name: legalInfo.contractFileName,
            size: legalInfo.contractUploadedAt
              ? `загружен ${new Date(legalInfo.contractUploadedAt).toLocaleDateString('ru-RU')}`
              : undefined,
          } : undefined}
          onDownload={downloading ? undefined : download}
        />
      </div>

      {/* Реквизиты */}
      <p className="text-micro text-fg-subtle mb-2">
        Иностранный контрагент: ИНН, КПП и ОГРН (российские реквизиты) можно оставить пустыми. Полное юридическое название и номер регистрации (VAT/EIN/иной) впишите прямо в «Наименование юрлица / ИП», адрес допустим в любом формате.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {LEGAL_FIELDS.map(f => (
          <div key={f.key} className={f.wide ? 'sm:col-span-2' : ''}>
            <label className="block text-micro font-medium text-fg-muted mb-1">{f.label}</label>
            <Input
              type="text"
              value={form[f.key] ?? ''}
              onChange={(e) => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
              placeholder={f.placeholder}
            />
          </div>
        ))}
      </div>
      <div className="mt-3">
        <Button type="button" onClick={save} disabled={!dirty || saving}>
          {saving ? 'Сохраняем…' : 'Сохранить реквизиты'}
        </Button>
      </div>
    </div>
  );
}

// ── Дисциплина РОПа: трекер согласует премию с собственником в переписке и вносит итог напрямую ──
// Бесшовно (item 5): без лендинга-ссылки и «маленького сайтика». Трекер обсудил условия в Telegram,
// вбил итог → премия подключается сразу (трекер берёт ответственность), суперадмину падает
// уведомление «согласовано с трекером». Легаси-ветка applyOwnerVariant остаётся для старых токенов.
function RopBonusProposalSection({ companyId, company, onSaved }: {
  companyId: string;
  company: AdminCompanyDetails['company'];
  onSaved: () => Promise<void>;
}) {
  const proposal = company.ropBonusProposal;
  const bonus = company.ropBonus;

  const [base, setBase] = useState(proposal?.draft?.baseAmount ?? bonus?.baseAmount ?? 20000);
  const [minThreshold, setMinThreshold] = useState(proposal?.draft?.minThresholdPct ?? bonus?.minThresholdPct ?? 60);
  const [payoutDay, setPayoutDay] = useState(proposal?.draft?.payoutDay ?? bonus?.payoutDay ?? 0);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  const rub = (n: number) => `${n.toLocaleString('ru-RU')} ₽`;
  const decision = proposal?.decision ?? null;
  const status = proposal?.status ?? null;
  const ov = proposal?.ownerVariant ?? null;

  const apply = async () => {
    setBusy(true);
    try {
      await adminApi.applyRopBonusAgreed(companyId, {
        baseAmount: base,
        minThresholdPct: minThreshold,
        payoutDay: payoutDay === 0 ? null : payoutDay,
        workdaysOnly: true,
      });
      toast.success('Премия подключена. Суперадмину ушло уведомление');
      setEditing(false);
      await onSaved();
    } catch {
      toast.error('Не удалось подключить премию');
    } finally {
      setBusy(false);
    }
  };

  const applyOwnerVariant = async () => {
    setBusy(true);
    try {
      await adminApi.applyRopBonusOwnerVariant(companyId);
      toast.success('Вариант собственника применён. Премия подключена');
      await onSaved();
    } catch {
      toast.error('Не удалось применить вариант');
    } finally {
      setBusy(false);
    }
  };

  const summary = (s: { baseAmount: number; minThresholdPct: number; payoutDay: number | null }) =>
    `${rub(s.baseAmount)} × % разборов в срок · отсечка ${s.minThresholdPct}%${s.payoutDay ? ` · выплата ${s.payoutDay}-го` : ''}`;

  // Редактор согласованных условий: JSX-константа (не вложенный компонент — иначе инпуты теряют фокус).
  const editorJsx = (
    <div className="mt-2 space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div>
          <label className="block text-micro font-medium text-fg-muted mb-1">База, ₽</label>
          <Input type="number" value={base} min={0} step={1000}
            onChange={e => setBase(Math.max(0, Number(e.target.value)))} />
        </div>
        <div>
          <label className="block text-micro font-medium text-fg-muted mb-1">Отсечка, %</label>
          <Input type="number" value={minThreshold} min={1} max={100}
            onChange={e => setMinThreshold(Math.max(1, Math.min(100, Number(e.target.value))))} />
        </div>
        <div>
          <label className="block text-micro font-medium text-fg-muted mb-1">День выплаты</label>
          <Input type="number" value={payoutDay} min={0} max={28}
            onChange={e => setPayoutDay(Math.max(0, Math.min(28, Number(e.target.value))))} />
        </div>
      </div>
      <Button type="button" onClick={apply} disabled={busy}>
        {busy ? 'Подключаем…' : 'Подключить премию'}
      </Button>
    </div>
  );

  // 1. Легаси: собственник прислал свой вариант со старой ссылки-лендинга, ждёт согласования трекера.
  if (decision === 'customized' && status === 'pending_review' && ov) {
    return (
      <div className="my-2">
        <Notice tone="warning" title="Собственник настроил свой вариант, нужно ваше согласование">
          <div className="space-y-2">
            <p>{summary(ov)}</p>
            <p className="text-micro">Сверьте сумму с договором и оформлением, затем примените. До применения премия в прод не пишется.</p>
            <Button type="button" onClick={applyOwnerVariant} disabled={busy}>
              {busy ? 'Применяем…' : 'Применить вариант собственника'}
            </Button>
          </div>
        </Notice>
      </div>
    );
  }

  // 2. Премия подключена.
  if (bonus?.enabled) {
    return (
      <div className="my-2">
        <Notice tone="success" title="Премия РОПа подключена">
          <div className="space-y-1">
            <p>
              {bonus.baseAmount ? summary({ baseAmount: bonus.baseAmount, minThresholdPct: bonus.minThresholdPct ?? 60, payoutDay: bonus.payoutDay ?? null }) : 'Настроена ступенями (легаси). Параметры в настройках компании.'}
            </p>
            {decision === 'recommended' && <p className="text-micro">Собственник принял рекомендацию сам.</p>}
            {decision === 'agreed' && <p className="text-micro">Согласовано с собственником напрямую и подключено вами.</p>}
          </div>
        </Notice>
      </div>
    );
  }

  // 3. Горящее: владелец в мастере попросил обсудить премию — согласуйте в переписке и внесите итог.
  if (decision === 'discuss') {
    return (
      <div className="my-2">
        <Notice tone="warning" title="Собственник хочет обсудить премию РОПа">
          <div className="space-y-2">
            <p>Он не принял рекомендацию и не отказался. Согласуйте условия в переписке и внесите итог: премия подключится сразу, суперадмину уйдёт уведомление.</p>
            {editorJsx}
          </div>
        </Notice>
      </div>
    );
  }

  // 4. Собственник осознанно отложил.
  if (bonus?.declinedExplicitly) {
    return (
      <Card padding="sm" surface="canvas" radius="block" className="my-2 space-y-2">
        <p className="text-body font-medium text-fg-muted">Собственник пока отложил премию</p>
        <Button type="button" variant="link" size="sm" onClick={() => setEditing(v => !v)}>Согласовали позже, внести условия →</Button>
        {editing && editorJsx}
      </Card>
    );
  }

  // 5. По умолчанию — прямой ввод согласованного.
  return (
    <div className="my-2">
      <p className="text-body text-fg-muted mb-2">
        Согласуйте премию для руководителя отдела продаж с собственником в переписке и внесите итог. Премия подключится сразу; суперадмину уйдёт уведомление, что условия согласованы с вами.
      </p>
      {editorJsx}
    </div>
  );
}

// Черновик kick-off сообщения приходит с бэка (launch-message.ts) вместе с хвостом доступов:
// сообщение собирается в одном месте, иначе куски расходятся — так в чат уехала ссылка дважды.

export function CompanyDetailPage() {
  const { companyId } = useParams<{ companyId: string }>();
  const navigate = useNavigate();

  const [details, setDetails] = useState<AdminCompanyDetails | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [crmOk, setCrmOk] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  // Map userId → temp password to show inline
  const [tempPasswords, setTempPasswords] = useState<Record<string, string>>({});
  // Именные ссылки первого входа, выданные в этой сессии карточки.
  const [accessLinks, setAccessLinks] = useState<Record<string, string>>({});
  const [resettingId, setResettingId] = useState<string | null>(null);

  const startImpersonation = useAuthStore(s => s.startImpersonation);
  const [impersonatingId, setImpersonatingId] = useState<string | null>(null);
  // Трекер ведёт онбординг, но опасные действия (вход «Глазами», удаление людей) ему закрыты.
  const viewerIsTracker = useAuthStore(s => s.user?.role) === 'tracker';
  const [confirmUser, setConfirmUser] = useState<AdminUser | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [offerCopied, setOfferCopied] = useState(false);
  const [offerMsgCopied, setOfferMsgCopied] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);
  // Токен может быть сгенерирован на лету для легаси-компании без него.
  const [offerToken, setOfferToken] = useState<string | null>(null);
  const [generatingOffer, setGeneratingOffer] = useState(false);
  // Фаза «Запуск»: черновик kick-off сообщения и отправка.
  const [launchDraft, setLaunchDraft] = useState('');
  const [launching, setLaunching] = useState(false);
  const [sendingAccessId, setSendingAccessId] = useState<string | null>(null);
  // Завершённый онбординг сворачивается аккордеоном (решение от 17.07): по умолчанию
  // закрыт, когда все шаги пройдены; null = пользователь ещё не трогал тумблер.
  const [onboardingOpenManual, setOnboardingOpenManual] = useState<boolean | null>(null);

  const handleSendAccess = async (userId: string) => {
    setSendingAccessId(userId);
    try {
      await adminApi.sendUserAccess(userId);
      toast.success('Доступ отправлен в рабочий чат');
    } catch (e) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || 'Не удалось отправить доступ', { duration: Infinity });
    } finally {
      setSendingAccessId(null);
    }
  };

  const launchNow = async () => {
    setLaunching(true);
    try {
      await adminApi.launchCompany(companyId!, launchDraft);
      toast.success('Стартовое сообщение отправлено в рабочий чат. Работа запущена');
      await loadData();
    } catch (e) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || 'Не удалось запустить. Попробуйте ещё раз', { duration: Infinity });
    } finally {
      setLaunching(false);
    }
  };

  // Ссылка-оферта: главный шаг онбординга. Копируется одной кнопкой для отправки владельцу.
  const copyOfferLink = async (token: string) => {
    const link = `${window.location.origin}/offer/${token}`;
    try {
      await navigator.clipboard.writeText(link);
      setOfferCopied(true);
      setTimeout(() => setOfferCopied(false), 2000);
      toast.success('Ссылка-оферта скопирована. Отправьте её владельцу');
    } catch {
      toast.error('Не удалось скопировать');
    }
  };

  // Готовое сообщение владельцу с линком: одна кнопка — вставил в мессенджер и отправил.
  // Без коммерческих деталей (даты триала, цены): это видит собственник клиента, а не трекер.
  const copyOfferMessage = async (token: string) => {
    const link = `${window.location.origin}/offer/${token}`;
    const message =
      'Здравствуйте! Подготовили для вашей команды рабочее пространство «Работа над ошибками».\n\n' +
      'Чтобы запустить его, откройте ссылку и подтвердите оферту (займёт минуту):\n' +
      link + '\n\n' +
      'После подтверждения пространство активируется и команда сможет приступить к работе. Если появятся вопросы, напишите нам.';
    try {
      await navigator.clipboard.writeText(message);
      setOfferMsgCopied(true);
      setTimeout(() => setOfferMsgCopied(false), 2000);
      toast.success('Сообщение с ссылкой скопировано. Вставьте владельцу в мессенджер');
    } catch {
      toast.error('Не удалось скопировать');
    }
  };

  // Смена жизненного статуса компании (бейдж трекера).
  const changeStatus = async (status: CompanyStatus) => {
    if (!companyId) return;
    // Пауза не выражается сменой ярлыка: у неё есть причина, дата возврата и ответственный.
    if (status === 'paused') { setPauseOpen(true); return; }
    setSavingStatus(true);
    try {
      await adminApi.setCompanyStatus(companyId, status);
      await loadData();
      toast.success(`Статус: ${COMPANY_STATUS_META[status].label}`);
    } catch {
      toast.error('Не удалось изменить статус');
    } finally {
      setSavingStatus(false);
    }
  };

  // Пауза с условиями: диалог вместо молчаливой смены статуса.
  const [pauseOpen, setPauseOpen] = useState(false);
  const [pauseReason, setPauseReason] = useState('');
  const [pauseReturn, setPauseReturn] = useState('');
  const [pauseResponsible, setPauseResponsible] = useState('');
  const [pauseCondition, setPauseCondition] = useState('');
  const [pauseBusy, setPauseBusy] = useState(false);
  // Перезапуск после простоя.
  const [relaunchOpen, setRelaunchOpen] = useState(false);
  const [relaunchDraft, setRelaunchDraft] = useState('');
  const [relaunching, setRelaunching] = useState(false);
  // Журнал событий компании.
  const [events, setEvents] = useState<CompanyEventItem[] | null>(null);
  const [eventsOpen, setEventsOpen] = useState(false);

  const savePause = async () => {
    if (!companyId) return;
    setPauseBusy(true);
    try {
      await adminApi.pauseCompany(companyId, {
        reason: pauseReason.trim(),
        expectedReturnAt: pauseReturn,
        responsible: pauseResponsible.trim() || undefined,
        conditionToEnd: pauseCondition.trim() || undefined,
      });
      setPauseOpen(false);
      setPauseReason(''); setPauseReturn(''); setPauseResponsible(''); setPauseCondition('');
      await loadData();
      toast.success('Компания на паузе. Вернёмся к ней в назначенную дату');
    } catch (err) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e?.response?.data?.message ?? 'Не удалось поставить на паузу', { duration: Infinity });
    } finally {
      setPauseBusy(false);
    }
  };

  // Приостановка работы за неоплату. Не пауза: пауза приглушает наши сообщения, а это
  // закрывает платформу команде клиента до оплаты.
  const [holdOpen, setHoldOpen] = useState(false);
  const [holdNote, setHoldNote] = useState('');
  const [holdBusy, setHoldBusy] = useState(false);

  const saveHold = async () => {
    if (!companyId) return;
    setHoldBusy(true);
    try {
      await adminApi.holdForPayment(companyId, holdNote.trim() || undefined);
      setHoldOpen(false);
      setHoldNote('');
      await loadData();
      toast.success('Работа приостановлена. Команда клиента видит экран с объяснением');
    } catch (err) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e?.response?.data?.message ?? 'Не удалось приостановить работу', { duration: Infinity });
    } finally {
      setHoldBusy(false);
    }
  };

  // Отметка «CRM подключать нечем»: гасит напоминания команде о подключении. Пока её нет,
  // платформа считает шаг просто пропущенным и напоминает, как у одного клиента, где команда
  // носила звонки файлами при живой amoCRM.
  const [crmNaBusy, setCrmNaBusy] = useState(false);
  const toggleCrmNotApplicable = async () => {
    if (!companyId) return;
    const turningOn = !company?.crmNotApplicable;
    let reason: string | undefined;
    if (turningOn) {
      reason = window.prompt('Почему подключать нечем? Например: нет CRM, звонки с личных телефонов.')?.trim();
      if (!reason) return;
    }
    setCrmNaBusy(true);
    try {
      await adminApi.setCrmNotApplicable(companyId, turningOn, reason);
      await loadData();
      toast.success(turningOn ? 'Напоминания о CRM выключены' : 'Напоминания о CRM возвращены');
    } catch (err) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e?.response?.data?.message ?? 'Не удалось изменить отметку', { duration: Infinity });
    } finally {
      setCrmNaBusy(false);
    }
  };

  const releaseHold = async () => {
    if (!companyId) return;
    setHoldBusy(true);
    try {
      await adminApi.releasePaymentHold(companyId);
      await loadData();
      toast.success('Приостановка снята. Команда работает как прежде');
    } catch (err) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e?.response?.data?.message ?? 'Не удалось снять приостановку', { duration: Infinity });
    } finally {
      setHoldBusy(false);
    }
  };

  const resumeWork = async () => {
    if (!companyId) return;
    setSavingStatus(true);
    try {
      await adminApi.resumeCompany(companyId);
      await loadData();
      toast.success('Пауза снята');
    } catch {
      toast.error('Не удалось снять паузу', { duration: Infinity });
    } finally {
      setSavingStatus(false);
    }
  };

  const relaunchNow = async () => {
    if (!companyId) return;
    setRelaunching(true);
    try {
      await adminApi.relaunchCompany(companyId, relaunchDraft);
      setRelaunchOpen(false);
      await loadData();
      toast.success('Работа перезапущена: сообщение ушло в чат, сторож включён заново');
    } catch (err) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e?.response?.data?.message ?? 'Не удалось перезапустить работу', { duration: Infinity });
    } finally {
      setRelaunching(false);
    }
  };

  const loadEvents = async () => {
    if (!companyId) return;
    try {
      const { data } = await adminApi.getCompanyEvents(companyId);
      setEvents(data);
    } catch {
      toast.error('Не удалось загрузить журнал событий');
    }
  };

  const [savingLicense, setSavingLicense] = useState(false);
  const changeLicenseMode = async (mode: 'trial' | 'implementation') => {
    if (!companyId) return;
    setSavingLicense(true);
    try {
      await adminApi.setLicenseMode(companyId, mode);
      await loadData();
      toast.success(mode === 'implementation' ? 'Режим: уже во внедрении (без триала)' : 'Режим: бесплатный тест');
    } catch {
      toast.error('Не удалось изменить режим');
    } finally {
      setSavingLicense(false);
    }
  };

  // Легаси-компания без токена: сгенерировать ссылку-оферту по запросу.
  // Не копируем автоматически: трекер сам выбирает «сообщением» или «ссылкой» кнопками ниже,
  // иначе владелец рискует получить голую ссылку без пояснения (см. copyOfferMessage).
  const generateOfferLink = async () => {
    if (!companyId) return;
    setGeneratingOffer(true);
    try {
      const { data } = await adminApi.ensureOfferLink(companyId);
      if (data.offerToken) {
        setOfferToken(data.offerToken);
        toast.success('Ссылка-оферта создана');
      }
    } catch {
      toast.error('Не удалось создать ссылку-оферту');
    } finally {
      setGeneratingOffer(false);
    }
  };

  // Рабочий ТГ-чат: ручная дата старта. editWorkStart — правка уже зафиксированной даты
  // (бот ставит старт по дате привязки чата; для клиентов, с кем начали раньше, её нужно поправить).
  const [manualDate, setManualDate] = useState('');
  const [savingWork, setSavingWork] = useState(false);
  const [editWorkStart, setEditWorkStart] = useState(false);

  const saveWorkStart = async () => {
    if (!companyId || !manualDate) return;
    setSavingWork(true);
    try {
      await adminApi.setWorkStart(companyId, manualDate);
      toast.success('Дата старта работы сохранена');
      setManualDate('');
      setEditWorkStart(false);
      await loadData();
    } catch {
      toast.error('Не удалось сохранить дату');
    } finally {
      setSavingWork(false);
    }
  };

  // Обнаруженные ботом чаты (куда добавили бота) — привязка одной кнопкой, без команды в чате клиента.
  const [detectedChats, setDetectedChats] = useState<Array<{ chatId: string; title: string | null; isAdmin: boolean }>>([]);
  const [polling, setPolling] = useState(false);
  const [bindingChatId, setBindingChatId] = useState<string | null>(null);

  // Бесшовное добавление бота: startgroup deep-link. Telegram открывает выбор группы, после
  // добавления бота приходит my_chat_member → чат виден в «Проверить». Без ручного ввода/печатания.
  const [botInvite, setBotInvite] = useState<{ botUsername: string | null; bindCode: string | null }>({ botUsername: null, bindCode: null });
  useEffect(() => {
    if (!companyId) return;
    adminApi.ensureBindCode(companyId)
      .then(({ data }) => setBotInvite({ botUsername: data.botUsername, bindCode: data.bindCode }))
      .catch(() => {});
  }, [companyId]);
  const startGroupUrl = botInvite.botUsername && botInvite.bindCode
    ? `https://t.me/${botInvite.botUsername}?startgroup=${botInvite.bindCode}`
    : null;
  const botHandle = botInvite.botUsername ? `@${botInvite.botUsername}` : 'Подключение Telegram не настроено';

  const openAddBotToChat = () => {
    if (!startGroupUrl) { toast.error('Бот ещё не готов, обновите страницу'); return; }
    window.open(startGroupUrl, '_blank', 'noopener');
    toast.info('Выберите рабочий чат команды в Telegram. Как добавите бота, нажмите «Проверить».');
  };

  const checkChats = async () => {
    setPolling(true);
    try {
      await adminApi.pollTelegram();
      const { data } = await adminApi.listDetectedChats();
      setDetectedChats(data);
      // Подхватываем авто-привязку: при добавлении через «Добавить бота в чат» бот сам
      // привязывает чат по коду — тогда шаг «Чат» станет готов без ручного клика «Привязать».
      await loadData();
      if (data.length) toast.success('Чат найден, привяжите нужный ниже');
      else toast.info('Если вы только что добавили бота, чат мог привязаться автоматически. Если нет, нажмите «Добавить бота в чат».');
    } catch {
      toast.error('Не удалось проверить');
    } finally {
      setPolling(false);
    }
  };

  const doBindChat = async (chatId: string) => {
    if (!companyId) return;
    setBindingChatId(chatId);
    try {
      await adminApi.bindChat(companyId, chatId);
      toast.success('Рабочий чат привязан');
      await loadData();
    } catch {
      toast.error('Не удалось привязать чат');
    } finally {
      setBindingChatId(null);
    }
  };

  // Полное удаление компании (необратимо) — с подтверждением вводом названия, только суперадмину.
  const [showDelete, setShowDelete] = useState(false);
  const [deleteInput, setDeleteInput] = useState('');
  const [deletingCompany, setDeletingCompany] = useState(false);

  const doDeleteCompany = async () => {
    if (!companyId) return;
    setDeletingCompany(true);
    try {
      await adminApi.deleteCompany(companyId);
      toast.success('Компания удалена');
      navigate('/dashboard');
    } catch {
      toast.error('Не удалось удалить компанию', { duration: Infinity });
      setDeletingCompany(false);
    }
  };

  // «Посмотреть глазами»: токен сотрудника на 15 минут, F5 возвращает суперадмина
  const handleImpersonate = async (userId: string) => {
    setImpersonatingId(userId);
    try {
      const { data } = await adminApi.impersonate(userId);
      startImpersonation(data.accessToken, data.user);
      navigate('/dashboard');
    } catch {
      toast.error('Не удалось войти от имени сотрудника', { duration: Infinity });
    } finally {
      setImpersonatingId(null);
    }
  };

  const loadData = async () => {
    if (!companyId) return;
    try {
      const [detailsRes, usersRes] = await Promise.all([
        adminApi.getCompanyDetails(companyId),
        adminApi.getCompanyUsers(companyId),
      ]);
      setDetails(detailsRes.data);
      setUsers(usersRes.data);
    } catch {
      toast.error('Не удалось загрузить данные компании', { duration: Infinity });
    } finally {
      setLoading(false);
    }
    // CRM — необязательный пункт готовности, грузим отдельно (может не быть подключения).
    try {
      const { data } = await crmApi.getConnection(companyId);
      setCrmOk(data?.status === 'ok');
    } catch { /* нет подключения — пункт останется невыполненным, это норма */ }
    // Обнаруженные ботом чаты (для привязки рабочего чата без команды).
    try {
      const { data } = await adminApi.listDetectedChats();
      setDetectedChats(data);
    } catch { /* ignore */ }
  };

  useEffect(() => { loadData(); }, [companyId]);

  // Черновик приходит с бэка; подставляем только в пустое поле, чтобы не затереть правки трекера.
  const draftDefault = details?.launch?.draftDefault;
  useEffect(() => {
    if (draftDefault && !launchDraft) setLaunchDraft(draftDefault);
  }, [draftDefault]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleUserAdded = (user: AdminUser, activationUrl: string) => {
    setUsers(prev => [...prev, user]);
    setAccessLinks(prev => ({ ...prev, [user.id]: activationUrl }));
    setShowAddForm(false);
  };

  const handleResetPassword = async (userId: string) => {
    setResettingId(userId);
    try {
      const { data } = await adminApi.resetUserPassword(userId);
      setTempPasswords(prev => ({ ...prev, [userId]: data.newPassword }));
      toast.success('Пароль сброшен');
    } catch {
      toast.error('Не удалось сбросить пароль', { duration: Infinity });
    } finally {
      setResettingId(null);
    }
  };

  const handleDelete = async () => {
    if (!confirmUser || !companyId) return;
    setDeletingId(confirmUser.id);
    try {
      await adminApi.removeCompanyUser(companyId, confirmUser.id);
      setUsers(prev => prev.filter(u => u.id !== confirmUser.id));
      toast.success(`${confirmUser.fullName} удалён из команды`);
      setConfirmUser(null);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e?.response?.data?.message ?? 'Не удалось удалить сотрудника', { duration: Infinity });
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-fg-subtle text-body animate-pulse">Загрузка...</div>
      </div>
    );
  }

  if (!details) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-danger text-body">Компания не найдена</div>
      </div>
    );
  }

  const { company, sprint } = details;
  const launchState = details.launch ?? { teamEntered: false, hasEntry: false, hasSelfReview: false, hasReview: false, draftDefault: '', accessPreview: '' };

  // ── Единый онбординг: шаги В ПРАВИЛЬНОМ ПОРЯДКЕ, каждый со статусом и действием ──
  const channels = company.reportChannels?.weeklyAccountability;
  const onboardingActive = !company.onboardingCompleted;
  const effectiveOfferToken = offerToken ?? company.offerToken ?? null;
  const showOffer = !company.offerAcceptedAt && onboardingActive; // для хедер-бейджа

  const contractOk = Boolean(company.legalInfo?.contractFileName);
  const offerOk = Boolean(company.offerAcceptedAt);
  const chatOk = Boolean(company.telegramWorkChatId);
  const workStartOk = Boolean(company.workStartedAt);
  const reviewerOk = users.filter(u => u.role === 'reviewer').length > 0;
  const managersOk = users.filter(u => u.role === 'manager').length > 0;
  const channelsOk = Boolean(channels?.emails?.length || channels?.telegramChatIds?.length);
  const disciplineOk = Boolean(company.ropBonus?.enabled || company.ropBonus?.declinedExplicitly);

  // Порядок по зависимостям: договор даёт реквизиты → чат фиксирует старт → на готовом
  // (реквизиты + дата старта) владелец принимает оферту → затем команда и настройки.
  // Договор виден всегда (фундамент); оферта/чат/старт — онбордингу, легаси не показываем как долги.
  type Step = { key: string; title: string; done: boolean; kind: 'contract' | 'offer' | 'chat' | 'workstart' | 'link' | 'discipline' | 'crm'; tab?: string; section?: string; action?: string; optional?: boolean };
  const steps: Step[] = [
    { key: 'contract', title: 'Договор и реквизиты заказчика', done: contractOk, kind: 'contract' as const },
    // Рабочий чат показываем всегда (п4): трекер/суперадмин привязывают чат к ЛЮБОЙ компании,
    // в том числе к завершившей онбординг, а не только к новой.
    { key: 'chat', title: 'Рабочий чат подключён', done: chatOk, kind: 'chat' as const },
    ...(onboardingActive || workStartOk ? [{ key: 'workstart', title: 'Старт работы зафиксирован', done: workStartOk, kind: 'workstart' as const }] : []),
    ...(onboardingActive || offerOk ? [{ key: 'offer', title: 'Оферта принята владельцем', done: offerOk, kind: 'offer' as const }] : []),
    // CRM — ДО команды: если у клиента есть CRM, из неё можно импортировать РОПа и менеджеров
    // (не заводить руками); если CRM нет — трекер добавляет команду вручную в шагах ниже.
    // Необязательный шаг: не блокирует «готово», но стоит на своём месте по логике.
    { key: 'crm', title: 'CRM для записи звонков', done: crmOk, kind: 'crm' as const, optional: true },
    { key: 'reviewer', title: 'РОП назначен', done: reviewerOk, kind: 'link', tab: 'team', action: 'Назначить РОПа' },
    { key: 'managers', title: 'Менеджеры добавлены', done: managersOk, kind: 'link', tab: 'team', action: 'Добавить менеджеров' },
    { key: 'channels', title: 'Каналы отчётов владельца', done: channelsOk, kind: 'link', tab: 'norms', section: 'report-channels', action: 'Указать каналы' },
    { key: 'discipline', title: 'Дисциплина РОПа выбрана', done: disciplineOk, kind: 'discipline' as const },
  ];
  // Необязательные шаги (CRM) не блокируют «готово» и не входят в счётчик N из M.
  const requiredSteps = steps.filter(s => !s.optional);
  const doneCount = requiredSteps.filter(s => s.done).length;
  const allReady = doneCount === requiredSteps.length;

  return (
    <div className="space-y-6">
      {/* Back button */}
      <Button
        type="button"
        onClick={() => navigate('/dashboard')}
        variant="link"
        size="sm"
        icon={<ArrowLeft />}
      >
        Все компании
      </Button>

      {/* Company header */}
      <Card padding="md">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <PageTitle text={company.name} />
              <CompanyStatusBadge status={company.status} />
              {/* Слева ярлык, который поставил человек, справа то, что видит система в данных.
                  Раньше поле было одно, и оно всегда показывало намерение, а не факт. */}
              {details?.computedHealth && (
                <Badge
                  tone={COMPUTED_HEALTH_BADGE_CONFIG[details.computedHealth.state].tone}
                  title={details.computedHealth.detail}
                >
                  По данным: {details.computedHealth.label.toLowerCase()}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              <StaffSummary
                managers={users.filter(u => u.role === 'manager').length}
                reviewers={users.filter(u => u.role === 'reviewer').length}
                owners={users.filter(u => u.role === 'owner').length}
                className="text-body text-fg-subtle"
              />
              {sprint ? (
                <span className="text-body text-fg-subtle">
                  {sprint.label}
                </span>
              ) : (
                <span className="text-micro text-fg-subtle">Нет активного спринта</span>
              )}
              {company.offerAcceptedAt ? (
                <>
                  <Badge tone="success">Оферта принята</Badge>
                  <span className="text-micro text-fg-subtle">
                    {company.trialEndsAt
                      ? `триал до ${new Date(company.trialEndsAt).toLocaleDateString('ru-RU')}`
                      : 'триал стартует с началом работы'}
                  </span>
                </>
              ) : showOffer ? (
                <Badge tone="warning">Оферта ждёт владельца</Badge>
              ) : null}
            </div>
          </div>
          <div className="flex gap-2 flex-wrap items-center">
            <div className="w-auto">
              <Select
                value={company.status}
                onChange={(e) => changeStatus(e.target.value as CompanyStatus)}
                disabled={savingStatus}
                aria-label="Статус компании"
              >
                {COMPANY_STATUS_ORDER.map(s => (
                  <option key={s} value={s}>{COMPANY_STATUS_META[s].label}</option>
                ))}
              </Select>
            </div>
            <Button
              type="button"
              onClick={() => navigate(`/sprint?companyId=${companyId}`)}
              variant="secondary"
              icon={<LayoutDashboard />}
            >
              Доска спринта
            </Button>
            <Button
              type="button"
              onClick={() => navigate(`/analytics?companyId=${companyId}`)}
              variant="secondary"
              icon={<BarChart3 />}
            >
              Аналитика
            </Button>
            <Button
              type="button"
              onClick={() => navigate(`/settings?companyId=${companyId}`)}
              variant="secondary"
              icon={<Settings />}
            >
              Настройки
            </Button>
          </div>
        </div>
        <div className="mt-3 flex items-start justify-between gap-3 flex-wrap">
          <p className="text-micro text-fg-subtle flex-1 min-w-64">
            Обычно вместо удаления ставят статус «Закрыта»: компания скрывается из активных, все данные сохраняются, это обратимо. Удаление ниже стирает компанию и все её данные без возврата.
          </p>
          {!viewerIsTracker && (
            <Button
              type="button"
              onClick={() => { setDeleteInput(''); setShowDelete(true); }}
              variant="danger"
              icon={<Trash2 />}
            >
              Удалить компанию
            </Button>
          )}
        </div>
      </Card>

      {/* Расхождение намерения и факта. Это и есть главный продукт разделения статуса и здоровья:
          строка «мы считаем, что работаем, а записей нет 22 дня» требует ответа человека. */}
      {details?.computedHealth?.mismatch && (
        <div className="bg-danger-subtle border border-danger-border rounded-card px-5 py-4">
          <p className="text-body font-semibold text-danger-fg">{details.computedHealth.mismatchText}</p>
          <p className="text-body text-danger-fg mt-1">{details.computedHealth.detail}</p>
          <p className="text-micro text-danger-fg mt-2">
            Либо статус не отражает реальность, либо работа встала. Поменяйте статус или перезапустите работу.
          </p>
        </div>
      )}

      {/* Приостановка за неоплату. Отдельно от паузы и от статуса: у паузы причина на стороне
          клиента и есть дата возврата, здесь причина в расчётах, а возврат зависит от оплаты.
          Включает и снимает только владелец ЧиП: это решение о деньгах, не производственное. */}
      {!viewerIsTracker && (
        company.paymentHold ? (
          <div className="bg-danger-subtle border border-danger-border rounded-card px-5 py-4">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <p className="text-body font-semibold text-danger-fg">
                  Работа приостановлена за неоплату
                  {company.paymentHoldInfo?.startedAt
                    ? ` с ${new Date(company.paymentHoldInfo.startedAt).toLocaleDateString('ru-RU')}`
                    : ''}
                </p>
                {company.paymentHoldInfo?.note && (
                  <p className="text-body text-danger-fg mt-1">Собственнику показано: {company.paymentHoldInfo.note}</p>
                )}
                <p className="text-micro text-danger-fg mt-2">
                  Команда клиента ({users.length} чел.) видит экран с объяснением вместо платформы. Данные
                  сохранены, напоминания и отчёты команде не уходят, наше наблюдение продолжается.
                </p>
              </div>
              <Button
                type="button"
                onClick={releaseHold}
                disabled={holdBusy}
              >
                {holdBusy ? 'Снимаем…' : 'Оплатили, снять приостановку'}
              </Button>
            </div>
          </div>
        ) : (
          <Card padding="none">
            <div className="px-5 py-4">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <p className="text-body font-semibold text-fg">Оплата</p>
                  <p className="text-micro text-fg-subtle mt-1">
                    Если клиент не оплатил, работу можно приостановить: команда увидит экран с объяснением
                    вместо платформы, данные останутся на месте. Снимается одной кнопкой после оплаты.
                  </p>
                </div>
                <Button
                  type="button"
                  onClick={() => { setHoldNote(''); setHoldOpen(true); }}
                  variant="danger"
                >
                  Приостановить за неоплату
                </Button>
              </div>
            </div>
          </Card>
        )
      )}

      {/* Напоминание о подключении CRM: платформа сама говорит команде, что звонки можно брать
          из CRM. Выключается только осознанным решением с причиной. */}
      <Card padding="none">
        <div className="px-5 py-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <p className="text-body font-semibold text-fg">Напоминание о подключении CRM</p>
              {company.crmNotApplicable ? (
                <p className="text-micro text-fg-subtle mt-1">
                  Выключено{company.crmNotApplicableInfo?.markedBy ? `, отметил ${company.crmNotApplicableInfo.markedBy}` : ''}.
                  {company.crmNotApplicableInfo?.reason ? ` Причина: ${company.crmNotApplicableInfo.reason}` : ''}
                </p>
              ) : (
                <p className="text-micro text-fg-subtle mt-1">
                  Если CRM не подключена дольше десяти дней, руководитель отдела продаж и владелец видят на
                  главной карточку с объяснением, зачем это нужно и как подключить. Выключайте, только когда
                  подключать действительно нечем.
                </p>
              )}
            </div>
            <Button
              type="button"
              onClick={toggleCrmNotApplicable}
              disabled={crmNaBusy}
              variant="secondary"
            >
              {company.crmNotApplicable ? 'Вернуть напоминание' : 'Подключать нечем'}
            </Button>
          </div>
        </div>
      </Card>

      {/* Условия паузы: без них пауза это исчезновение клиента без срока. */}
      {company.status === 'paused' && (
        <Card padding="none" surface="canvas">
          <div className="px-5 py-4">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <p className="text-body font-semibold text-fg">
                  На паузе
                  {company.pauseInfo?.expectedReturnAt
                    ? ` до ${new Date(company.pauseInfo.expectedReturnAt).toLocaleDateString('ru-RU')}`
                    : ' без даты возврата'}
                </p>
                {company.pauseInfo?.reason && <p className="text-body text-fg-muted mt-1">Причина: {company.pauseInfo.reason}</p>}
                {company.pauseInfo?.responsible && (
                  <p className="text-body text-fg-muted">Ответственный у клиента: {company.pauseInfo.responsible}</p>
                )}
                {company.pauseInfo?.conditionToEnd && (
                  <p className="text-body text-fg-muted">Условие возврата: {company.pauseInfo.conditionToEnd}</p>
                )}
                <p className="text-micro text-fg-subtle mt-2">
                  Сигналы команде клиента приглушены, наблюдение за компанией продолжается. В дату возврата платформа напомнит.
                </p>
              </div>
              <Button
                type="button"
                onClick={resumeWork}
                disabled={savingStatus}
                variant="secondary"
              >
                Вернуть в работу
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Онбординг компании — единый чек-лист В ПОРЯДКЕ: каждый шаг со статусом и действием.
          Завершённый сворачивается аккордеоном: заголовка достаточно, шаги не мозолят глаза. */}
      <Card padding="sm" tone={allReady ? 'success' : 'warning'}>
        <Button
          type="button"
          onClick={() => setOnboardingOpenManual(!(onboardingOpenManual ?? !allReady))}
          variant="ghost"
          size="md"
          fullWidth
          aria-expanded={onboardingOpenManual ?? !allReady}
          icon={allReady ? <CheckCircle2 className="text-success-fg" /> : <Circle className="text-warning" />}
        >
          <span className="flex items-center justify-between gap-2 w-full text-left font-normal">
            <h2 className="flex-1 text-body-lg font-semibold text-fg">
              {allReady ? 'Онбординг завершён' : `Онбординг компании · ${doneCount} из ${requiredSteps.length}`}
            </h2>
            <ChevronRight
              className={cn('w-4 h-4 text-fg-disabled transition-transform', (onboardingOpenManual ?? !allReady) && 'rotate-90')}
            />
          </span>
        </Button>

        {(onboardingOpenManual ?? !allReady) && (
        <div className="space-y-2 mt-4">
          {steps.map((step) => (
            <div key={step.key} className="rounded-block border border-border">
              <div className="flex items-center gap-3 px-3 py-2.5">
                <span className={cn('flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-micro font-semibold',
                  step.done ? 'bg-success-subtle text-success-fg' : step.optional ? 'bg-accent-subtle text-accent-focus' : 'bg-surface-sunken text-fg-subtle')}
                  title={step.optional ? 'Необязательный шаг' : undefined}>
                  {step.done ? <Check className="w-3.5 h-3.5" /> : step.optional ? <Plus className="w-3.5 h-3.5" /> : requiredSteps.findIndex(s => s.key === step.key) + 1}
                </span>
                <span className={cn('flex-1 min-w-0 text-body', step.done ? 'text-fg-muted' : 'text-fg font-medium')}>{step.title}</span>
                {step.kind === 'link' && !step.done && (
                  <Button
                    type="button"
                    onClick={() => navigate(`/settings?companyId=${companyId}&tab=${step.tab}${step.section ? `&section=${step.section}` : ''}`)}
                    variant="secondary"
                    size="sm"
                   iconRight={<ChevronRight />}>
                    {step.action}
</Button>
                )}
                {step.kind === 'workstart' && step.done && company.trialEndsAt && (
                  <span className="flex-shrink-0 text-micro text-fg-subtle">триал до {new Date(company.trialEndsAt).toLocaleDateString('ru-RU')}</span>
                )}
              </div>

              {step.kind === 'contract' && (
                <div className="px-3 pb-3 border-t border-border">
                  <LegalInfoSection companyId={companyId!} legalInfo={company.legalInfo} onSaved={loadData} />
                </div>
              )}

              {step.kind === 'offer' && !step.done && (
                <div className="px-3 pb-3 border-t border-border">
                  {!contractOk ? (
                    <div className="my-2">
                      <Notice tone="warning" title="Сначала загрузите договор в шаге «Договор и реквизиты заказчика» выше.">
                        Оферта подставляет туда реквизиты заказчика: без договора владелец увидит в оферте пустые поля.
                      </Notice>
                    </div>
                  ) : (
                    <>
                      <p className="text-body text-fg-muted my-2">
                        Владелец открывает ссылку, в один клик принимает оферту и становится владельцем пространства. До этого пространство не запущено.
                      </p>
                      {effectiveOfferToken ? (
                        <div className="space-y-2">
                          <Input readOnly value={`${window.location.origin}/offer/${effectiveOfferToken}`} onFocus={(e) => e.currentTarget.select()} />
                          <div className="flex gap-2 flex-wrap">
                            <Button type="button" onClick={() => copyOfferMessage(effectiveOfferToken)}
                              icon={offerMsgCopied ? <Check /> : <MessageSquare />}>
                              {offerMsgCopied ? 'Скопировано' : 'Скопировать сообщение'}
                            </Button>
                            <Button variant="secondary" size="md" onClick={() => copyOfferLink(effectiveOfferToken)}
                              icon={offerCopied ? <Check /> : <Copy />}>
                              {offerCopied ? 'Скопировано' : 'Скопировать ссылку'}
                            </Button>
                            <a href={`/offer/${effectiveOfferToken}`} target="_blank" rel="noopener noreferrer"
                              className="flex items-center gap-1.5 px-3 py-2 border border-accent-border text-accent-fg rounded-control text-body font-medium hover:bg-accent-subtle-hover transition-colors">
                              <ExternalLink className="w-4 h-4" />Открыть
                            </a>
                          </div>
                          <p className="text-micro text-fg-subtle">
                            «Скопировать сообщение»: готовый текст с ссылкой для отправки владельцу в мессенджер. «Скопировать ссылку»: если хотите написать своими словами.
                          </p>
                        </div>
                      ) : (
                        <Button type="button" onClick={generateOfferLink} disabled={generatingOffer} icon={<Copy />}>
                          {generatingOffer ? 'Создаём…' : 'Создать ссылку-оферту'}
                        </Button>
                      )}
                    </>
                  )}
                </div>
              )}

              {step.kind === 'chat' && !step.done && (
                <div className="px-3 pb-3 border-t border-border">
                  <p className="text-body text-fg-muted my-2">
                    Одна кнопка: откроется Telegram, выберите рабочий чат команды, бот добавится сам и чат появится здесь. Ничего печатать не нужно.
                  </p>
                  <p className="text-micro text-fg-subtle mb-2">
                    Telegram предложит назначить бота администратором, согласитесь. Все дополнительные галочки прав можно оставить выключенными, боту хватает самого статуса администратора.
                  </p>
                  <div className="flex flex-wrap gap-2 mb-3">
                    <Button type="button" onClick={openAddBotToChat} disabled={!startGroupUrl} icon={<MessageSquare />}>
                      Добавить бота в чат
                    </Button>
                    <Button variant="secondary" size="md" onClick={checkChats} disabled={polling} icon={<RotateCcw />}>
                      {polling ? 'Проверяем…' : 'Проверить'}
                    </Button>
                  </div>
                  {detectedChats.length > 0 ? (
                    <div className="space-y-2">
                      <p className="text-micro text-fg-subtle">Бот добавлен в эти чаты. Привяжите нужный:</p>
                      {rankDetectedChats(detectedChats, [company.name, company.legalInfo?.legalName ?? '']).map(c => (
                        <div key={c.chatId} data-ui-role="chat-choice-row" className={cn(
                          'flex items-center gap-2 border rounded-card px-3 py-2',
                          c.isLikely ? 'bg-accent-subtle border-accent-border' : 'bg-canvas border-border',
                        )}>
                          <MessageSquare className={cn('w-4 h-4 flex-shrink-0', c.isLikely ? 'text-accent' : 'text-fg-disabled')} />
                          <span className="flex-1 min-w-0 text-body text-fg-muted truncate">{c.title || `Чат ${c.chatId}`}</span>
                          {c.isLikely && <span className="text-micro font-medium text-accent-hover flex-shrink-0">похоже, этот</span>}
                          <Button type="button" onClick={() => doBindChat(c.chatId)} disabled={bindingChatId === c.chatId} size="sm">
                            {bindingChatId === c.chatId ? 'Привязываем…' : 'Привязать'}
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-body text-fg-subtle">
                      Чатов с ботом пока нет. Нажмите «Добавить бота в чат» и выберите рабочий чат, он появится здесь автоматически.
                    </p>
                  )}
                  <details className="mt-3">
                    <summary className="text-micro text-fg-subtle cursor-pointer hover:text-fg-muted">Добавить вручную</summary>
                    <div className="flex gap-2 mt-2">
                      <Card padding="none" className="flex-1 min-w-0"><div className="px-3 py-2 text-body font-mono text-fg-muted truncate">{botHandle}</div></Card>
                      <Button variant="ghost" size="md" onClick={async () => { try { await navigator.clipboard.writeText(botHandle); toast.success('Ник бота скопирован'); } catch { /* ignore */ } }}
                        icon={<Copy />}>
                        Копировать ник
                      </Button>
                    </div>
                    <p className="text-micro text-fg-subtle mt-1.5">Найдите бота по нику в Telegram и добавьте его в рабочий чат, затем нажмите «Проверить».</p>
                  </details>
                </div>
              )}

              {step.kind === 'workstart' && (!step.done || editWorkStart) && (
                <div className="px-3 pb-3 border-t border-border">
                  {/* Режим лицензии: тест или уже-внедрение (команда, идущая с нами по контракту) */}
                  <div className="my-2">
                    <p className="text-micro font-medium text-fg-subtle mb-1.5">Режим лицензии</p>
                    <div className="flex flex-wrap gap-2">
                      {(['trial', 'implementation'] as const).map((m) => (
                        <Button key={m} type="button" variant={(company.licenseMode ?? 'trial') === m ? 'primary' : 'secondary'} size="sm" onClick={() => changeLicenseMode(m)} disabled={savingLicense}>
                          {m === 'trial' ? 'Бесплатный тест' : 'Уже во внедрении'}
                        </Button>
                      ))}
                    </div>
                    <p className="text-micro text-fg-subtle mt-1">
                      {(company.licenseMode ?? 'trial') === 'implementation'
                        ? 'Команда уже во внедрении: лицензия бесплатна на весь этап, счётчик триала не показывается, оферта без срока теста.'
                        : 'Бесплатный тест на срок триала от даты старта работы.'}
                    </p>
                  </div>
                  <p className="text-body text-fg-muted my-2">
                    {step.done
                      ? 'Бот фиксирует старт по дате привязки чата (историю до добавления бота он не видит). Если работа с клиентом началась раньше, впишите реальную дату, и бесплатный период пересчитается от неё:'
                      : company.telegramWorkChatId
                        ? 'Чат привязан. Старт зафиксируется по первому рабочему сообщению. Либо впишите дату вручную (для чатов, которые уже идут):'
                        : 'Зафиксируется по первой активности в привязанном чате. Либо впишите дату старта вручную:'}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <div className="flex-1 min-w-48" data-ds-exception="браузерная дата до DateField 0.9.1">
                      <Input type="date" value={manualDate} onChange={(e) => setManualDate(e.target.value)} />
                    </div>
                    <Button type="button" onClick={saveWorkStart} disabled={!manualDate || savingWork}>
                      {savingWork ? 'Сохраняем…' : 'Сохранить дату'}
                    </Button>
                    {step.done && editWorkStart && (
                      <Button type="button" variant="ghost" size="md" onClick={() => { setEditWorkStart(false); setManualDate(''); }}>
                        Отмена
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {step.kind === 'chat' && step.done && (
                <div className="px-3 pb-2.5 -mt-1"><span className="text-micro text-fg-subtle ml-9">Чат подключён</span></div>
              )}
              {step.kind === 'workstart' && step.done && company.workStartedAt && !editWorkStart && (
                <div className="px-3 pb-2.5 -mt-1 flex items-center gap-2 ml-9">
                  <span className="text-micro text-fg-subtle">Работа началась {new Date(company.workStartedAt).toLocaleDateString('ru-RU')}</span>
                  <Button
                    type="button"
                    onClick={() => { setManualDate(company.workStartedAt!.slice(0, 10)); setEditWorkStart(true); }}
                    variant="link"
                    size="sm">
                    изменить
                  </Button>
                </div>
              )}

              {step.kind === 'discipline' && (
                <div className="px-3 pb-3 border-t border-border">
                  <RopBonusProposalSection companyId={companyId!} company={company} onSaved={loadData} />
                </div>
              )}

              {step.kind === 'crm' && (
                <div className="px-3 pb-3 border-t border-border">
                  {crmOk ? (
                    <div className="my-2 space-y-2">
                      {/* Команда уже заведена — призыв к импорту неуместен, только статус. */}
                      {reviewerOk && managersOk ? (
                        <p className="text-body text-fg-muted">
                          CRM подключена: звонки подтягиваются автоматически. Команда уже заведена, импорт не требуется.
                        </p>
                      ) : (
                        <>
                          <p className="text-body text-fg-muted">
                            CRM подключена: звонки подтягиваются автоматически. Можно импортировать команду (РОПа и менеджеров) прямо из CRM, чтобы не заводить вручную.
                          </p>
                          <Button
                            type="button"
                            onClick={() => navigate(`/settings?companyId=${companyId}&tab=integrations`)}
                           iconRight={<ChevronRight />}>
                            Импортировать команду из CRM
</Button>
                        </>
                      )}
                    </div>
                  ) : (
                    <div className="my-2 space-y-2">
                      <p className="text-body text-fg-muted">
                        Если у клиента есть CRM (amoCRM или Bitrix24), подключите её сейчас: звонки будут подтягиваться сами, а РОПа и менеджеров можно импортировать из CRM в один шаг, не заводя вручную.
                        Доступ к порталу есть только у клиента, поэтому на вкладке «Интеграции» первой стоит кнопка «Отправить в рабочий чат»: администратор CRM подключит портал сам по ссылке, а вам придёт уведомление.
                      </p>
                      {/* Спросить про свою расшифровку у клиента до отправки ссылки, не после.
                          Прецедент: клиент сообщил о своей системе аналитики звонков в ответ на
                          готовую ссылку — трекер узнал об этом постфактум, хотя вопрос дешевле
                          задать один раз на созвоне заранее. */}
                      <Card padding="none" surface="canvas">
                        <div className="px-3 py-2">
                          <p className="text-micro text-fg-subtle">
                            Перед отправкой ссылки спросите у клиента: нет ли у него уже своей расшифровки
                            или аналитики звонков помимо CRM (свой сервис, скрипт, речевая аналитика провайдера
                            телефонии)? Если есть, готовить для платформы ничего не нужно: она продолжит
                            расшифровывать сама, просто вы будете знать об этом заранее, а не после того,
                            как клиент удивится присланной ссылке.
                          </p>
                        </div>
                      </Card>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          onClick={() => navigate(`/settings?companyId=${companyId}&tab=integrations`)}
                          variant="secondary"
                         iconRight={<ChevronRight />}>
                          Подключить CRM
</Button>
                      </div>
                      {/* Подписка Битрикса — единственный барьер, который клиент закрывает сам.
                          Без неё портал молча не отдаёт записи, и «звонки не подтягиваются»
                          всплывает уже после запуска. Проверять на созвоне, до подключения. */}
                      <Notice tone="warning" title="Битрикс24: до подключения проверьте у клиента активную подписку.">
                        {B24_MARKETPLACE_NAME} ({B24_MARKETPLACE_PRICE}, оплачивается в Битрикс24). Без неё портал не отдаёт записи звонков, и это выяснится уже после запуска.
                      </Notice>
                      <p className="text-micro text-fg-subtle">
                        Нет CRM? Ничего страшного, шаг необязательный. Добавьте РОПа и менеджеров вручную в шагах ниже.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
        )}
      </Card>

      {/* Запуск работы: онбординг настроил пространство, запуск заводит команду (нулевой оборот петли). */}
      {company.launchedAt && launchState.hasReview ? (
        <div className="flex items-center gap-2 bg-success-subtle border border-success-border rounded-block px-4 py-3">
          <Rocket className="w-4 h-4 text-success-fg flex-shrink-0" />
          <p className="text-body text-success-fg">
            Работа запущена {new Date(company.launchedAt).toLocaleDateString('ru-RU')}, петля прокрутилась: первый разбор РОПа прошёл.
          </p>
        </div>
      ) : (allReady || company.launchedAt) ? (
        <Card padding="sm" tone={company.launchedAt ? 'success' : 'accent'}>
          <div className="flex items-center gap-2 mb-3">
            <Rocket className={cn('w-5 h-5', company.launchedAt ? 'text-success-fg' : 'text-accent')} />
            <h2 className="text-body-lg font-semibold text-fg">
              {company.launchedAt
                ? `Запуск · работа началась ${new Date(company.launchedAt).toLocaleDateString('ru-RU')}`
                : 'Запуск работы'}
            </h2>
          </div>

          {!company.launchedAt ? (
            <div className="space-y-3">
              <p className="text-body text-fg-muted">
                Пространство настроено, но команда об этом ещё не знает. Отправьте стартовое сообщение
                в рабочий чат: оно объясняет, кто что делает на первой неделе. Текст можно поправить под клиента.
              </p>
              {/* Черновик и хвост с доступами показаны встык: трекер видит целиком то, что уйдёт
                  в чат. Раньше хвост описывался словами, и сообщение выглядело оборванным. */}
              <div>
                <Textarea
                  value={launchDraft}
                  onChange={(e) => setLaunchDraft(e.target.value)}
                  rows={9}
                />
                {launchState.accessPreview && (
                  <div data-ui-role="attached-editor-footer" className="border border-t-0 border-border rounded-b-card bg-canvas px-3 py-2.5">
                    <p className="text-micro text-fg-subtle mb-1.5">
                      Дальше платформа сама допишет доступы команды. В чат уйдёт одним сообщением:
                    </p>
                    <p className="text-body text-fg-muted whitespace-pre-wrap">
                      {launchState.accessPreview.trim()}
                    </p>
                  </div>
                )}
              </div>
              {!chatOk && (
                <Notice tone="warning" title="Рабочий чат не подключён: стартовое сообщение отправлять некуда.">
                  Подключите чат в шаге выше.
                </Notice>
              )}
              <Button
                type="button"
                onClick={launchNow}
                disabled={!chatOk || launching || !launchDraft.trim()}
                icon={<Rocket />}
              >
                {launching ? 'Отправляем…' : 'Отправить в чат и запустить работу'}
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-body text-fg-muted">
                Команда получила стартовое сообщение. Дальше петля должна прокрутиться первый раз:
              </p>
              {[
                { done: launchState.teamEntered, title: 'Команда вошла на платформу' },
                { done: launchState.hasEntry, title: 'Первая запись загружена' },
                { done: launchState.hasSelfReview, title: 'Первый самоанализ отправлен' },
                { done: launchState.hasReview, title: 'Первый разбор РОПа' },
              ].map((item) => (
                <div key={item.title} className="flex items-center gap-3 rounded-block border border-border px-3 py-2.5">
                  <span className={cn('flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center',
                    item.done ? 'bg-success-subtle text-success-fg' : 'bg-surface-sunken text-fg-subtle')}>
                    {item.done ? <Check className="w-3.5 h-3.5" /> : <Circle className="w-3 h-3" />}
                  </span>
                  <span className={cn('text-body', item.done ? 'text-fg-muted' : 'text-fg font-medium')}>{item.title}</span>
                </div>
              ))}
              <p className="text-micro text-fg-subtle pt-1">
                После первого разбора компания сама перейдёт в статус «Активна». Отчёт владельцу уйдёт
                автоматически в понедельник 09:00. Если за 48 часов не появится ни одной записи, вы получите
                сигнал в колокольчик, а РОП в Telegram; через 5 дней тишины команде уйдёт напоминание в рабочий чат.
              </p>

              {/* Перезапуск: после простоя нужен мини-старт, а не «снятие галочки». Команда уже
                  видела, что работу объявили и ничего не произошло, поэтому сообщение короткое,
                  от лица собственника и с датой. Новая точка отсчёта включает сторожа заново. */}
              <div className="pt-3 border-t border-border">
                {!relaunchOpen ? (
                  <Button
                    type="button"
                    onClick={() => {
                      setRelaunchDraft(
                        `Коллеги, возобновляем «Работу над ошибками» с ${new Date().toLocaleDateString('ru-RU')}.\n\n` +
                        `Первая неделя разгонная: с каждого менеджера ждём три записи вместо пяти. ` +
                        `Руководитель отдела продаж разбирает каждую запись в течение суток.\n\n` +
                        `Доступы каждого ниже в этом сообщении.`,
                      );
                      setRelaunchOpen(true);
                    }}
                    variant="secondary"
                    icon={<Rocket />}
                  >
                    Перезапустить работу
                  </Button>
                ) : (
                  <div className="space-y-3">
                    <p className="text-body text-fg-muted">
                      Сообщение о возобновлении уйдёт в рабочий чат вместе с доступами тех, кто ещё не входил.
                      Отсчёт запуска начнётся заново: сторож тишины снова следит за первой записью.
                    </p>
                    <Textarea
                      value={relaunchDraft}
                      onChange={(e) => setRelaunchDraft(e.target.value)}
                      rows={7}
                    />
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        onClick={relaunchNow}
                        disabled={!chatOk || relaunching || !relaunchDraft.trim()}
                        icon={<Rocket />}
                      >
                        {relaunching ? 'Отправляем…' : 'Отправить и перезапустить'}
                      </Button>
                      <Button
                        type="button"
                        onClick={() => setRelaunchOpen(false)}
                        variant="ghost"
                        size="md"
                      >
                        Отмена
                      </Button>
                    </div>
                    {!chatOk && (
                      <Notice tone="warning" title="Рабочий чат не подключён: отправлять сообщение некуда." />
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </Card>
      ) : null}

      {/* Нормативы: зона трекера, но применить режим он раньше не мог — они жили только у владельца. */}
      <NormPresetPicker companyId={companyId!} />

      {/* Как человек получает доступ */}
      <div className="flex items-start gap-3 bg-info-subtle border border-info-subtle rounded-block px-4 py-3">
        <Lock className="w-4 h-4 text-info flex-shrink-0 mt-0.5" />
        <p className="text-body text-info-fg">
          Паролей платформа не рассылает. Новому сотруднику уходит <strong>именная ссылка входа</strong>:
          он переходит по ней, придумывает пароль сам, и ссылка гаснет. Живёт 3 дня, выслать заново можно
          кнопкой <strong>«Доступ в чат»</strong>. Если человек уже входил и забыл пароль, он восстанавливает
          его сам через «Забыли пароль» на странице входа.
        </p>
      </div>

      {/* Team section */}
      <Card padding="none">
        {/* Section header */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-4 border-b border-border">
          <h2 className="text-body-lg font-semibold text-fg">
            Команда · {users.length} чел.
          </h2>
          {!showAddForm && (
            <Button
              type="button"
              onClick={() => setShowAddForm(true)}
              size="sm"
              icon={<Plus />}
            >
              Добавить
            </Button>
          )}
        </div>

        {/* Add user form */}
        {showAddForm && (
          <div className="px-5 py-4 border-b border-border">
            <AddUserForm
              companyId={companyId!}
              onSuccess={handleUserAdded}
              onCancel={() => setShowAddForm(false)}
            />
          </div>
        )}

        {/* Users list */}
        {users.length === 0 ? (
          <div className="py-12 px-5 text-center text-fg-subtle text-body">
            Нет пользователей. Добавьте первого!
          </div>
        ) : (
          <div className="divide-y divide-canvas">
            {users.map(user => (
              <div key={user.id} className="flex flex-wrap items-center gap-4 px-5 py-3">
                {/* Avatar */}
                <Avatar name={user.fullName} color={user.color ?? undefined} size="md" />

                {/* Name + role */}
                <div className="flex-1 min-w-48">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-body font-medium text-fg">{user.fullName}</span>
                    <Badge tone={(ROLE_BADGE_CONFIG[user.role as keyof typeof ROLE_BADGE_CONFIG] ?? DEFAULT_ROLE_BADGE_CONFIG).tone}>
                      {ROLE_LABELS[user.role] ?? user.role}
                    </Badge>
                    {user.neverLoggedIn && (
                      <Badge tone="warning" title="Сотрудник ни разу не входил на платформу">
                        ещё не входил
                      </Badge>
                    )}
                    {/* Без личной привязки к боту РОП молча не получает утренний дайджест —
                        трекер видит это сразу, а не из воскресного свода через неделю. */}
                    {user.role === 'reviewer' && !user.neverLoggedIn && user.telegramLinked === false && (
                      <Badge tone="warning" title="РОП не подключил Telegram: утренние напоминания о записях, ждущих разбора, ему не приходят. Попросите его нажать «Подключить Telegram» на главной странице">
                        без Telegram
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                    <span className="text-micro text-fg-subtle">{user.email}</span>
                    {accessLinks[user.id] && (
                      <AccessLinkBadge
                        url={accessLinks[user.id]}
                        onDismiss={() =>
                          setAccessLinks(prev => {
                            const next = { ...prev };
                            delete next[user.id];
                            return next;
                          })
                        }
                      />
                    )}
                    {tempPasswords[user.id] && (
                      <span data-ui-role="password-value" className="flex items-center gap-2 bg-canvas border border-border rounded-card px-3 py-1.5 text-micro text-fg-muted">
                        Пароль сброшен:
                        <code className="font-mono font-semibold text-fg bg-surface-sunken px-1.5 py-0.5 rounded-chip">{tempPasswords[user.id]}</code>
                        <Button
                          type="button"
                          onClick={() => { navigator.clipboard?.writeText(tempPasswords[user.id]); toast.success('Пароль скопирован'); }}
                          variant="ghost"
                          size="sm"
                          title="Скопировать"
                          icon={<Copy />}
                        />
                      </span>
                    )}
                  </div>
                </div>

                {/* Действия: на узком экране уходят второй строкой целой группой, а не торчат за край */}
                <div className="flex items-center gap-x-2 gap-y-3 flex-wrap">
                {/* Досылка доступа в рабочий чат: только не входившим и только при привязанном чате */}
                {user.neverLoggedIn && chatOk && (
                  <Button
                    type="button"
                    onClick={() => handleSendAccess(user.id)}
                    disabled={sendingAccessId === user.id}
                    variant="secondary"
                    size="sm"
                    title="Отправить в рабочий чат именную ссылку входа (живёт 3 дня, гаснет после первого входа)"
                    icon={<MessageSquare />}
                  >
                    {sendingAccessId === user.id ? 'Шлём…' : 'Доступ в чат'}
                  </Button>
                )}

                {/* Посмотреть платформу глазами сотрудника — опасное, трекеру закрыто */}
                {!viewerIsTracker && (
                  <Button
                    type="button"
                    onClick={() => handleImpersonate(user.id)}
                    disabled={impersonatingId === user.id}
                    variant="secondary"
                    size="sm"
                    title="Открыть платформу так, как её видит этот сотрудник"
                    icon={<Eye />}
                  >
                    {impersonatingId === user.id ? 'Входим…' : 'Глазами'}
                  </Button>
                )}

                {/* Сброс пароля даёт полный доступ под чужим именем не хуже «Глазами» — та же граница, трекеру закрыто (SEC-3) */}
                {!viewerIsTracker && (
                  <Button
                    type="button"
                    onClick={() => handleResetPassword(user.id)}
                    disabled={resettingId === user.id}
                    variant="secondary"
                    size="sm"
                    title="Сбросить пароль и показать новый"
                    icon={<RotateCcw className={cn(resettingId === user.id && 'animate-spin')} />}
                  >
                    {resettingId === user.id ? 'Сброс...' : 'Пароль'}
                  </Button>
                )}

                {/* Удалить сотрудника — нельзя удалить владельца; трекеру удаление людей закрыто */}
                {user.role !== 'owner' && !viewerIsTracker && (
                  <Button
                    type="button"
                    onClick={() => setConfirmUser(user)}
                    disabled={deletingId === user.id}
                    variant="danger"
                    size="sm"
                    title="Удалить сотрудника из команды"
                    icon={<Trash2 />}
                  >
                    {deletingId === user.id ? 'Удаляем…' : 'Удалить'}
                  </Button>
                )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Подтверждение удаления сотрудника */}
      <Modal
        open={!!confirmUser}
        onClose={() => { if (deletingId === null) setConfirmUser(null); }}
        title="Удалить сотрудника?"
        footer={(
          <>
            <Button variant="ghost" size="md"
              onClick={() => setConfirmUser(null)}
              disabled={deletingId !== null}
              
            >
              Отмена
            </Button>
            <Button variant="danger" size="md"
              onClick={handleDelete}
              disabled={deletingId !== null}
              
            >
              {deletingId !== null ? 'Удаляем…' : 'Удалить'}
            </Button>
          </>
        )}
      >
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-danger-subtle flex items-center justify-center">
            <Trash2 className="w-5 h-5 text-danger" />
          </div>
          <div className="min-w-0">
            <p className="text-body text-fg-muted mt-1.5">
              <strong className="text-fg">{confirmUser?.fullName}</strong>
              {' '}({ROLE_LABELS[confirmUser?.role ?? ''] ?? confirmUser?.role}) сразу потеряет доступ к платформе.
              Его прошлые разборы и закрытые спринты останутся в истории.
            </p>
          </div>
        </div>
      </Modal>

      {/* Подтверждение полного удаления компании — вводом названия (необратимо) */}
      {/* Журнал событий компании: что происходило и доходили ли сигналы. Свёрнут по умолчанию —
          нужен, когда разбираешься, а не каждый день. Без него любой следующий разбор снова
          пришлось бы собирать по переписке. */}
      <Card padding="none">
        <Button
          type="button"
          onClick={() => {
            const next = !eventsOpen;
            setEventsOpen(next);
            if (next && events === null) loadEvents();
          }}
          variant="ghost"
          size="md"
          fullWidth
        >
          <span className="flex items-center justify-between w-full text-left font-normal">
            <h2 className="text-body-lg font-semibold text-fg">Журнал событий</h2>
            <span className="text-micro text-fg-subtle">{eventsOpen ? 'свернуть' : 'развернуть'}</span>
          </span>
        </Button>
        {eventsOpen && (
          <div className="px-5 pb-5">
            {events === null ? (
              <p className="text-body text-fg-subtle">Загружаем…</p>
            ) : events.length === 0 ? (
              <p className="text-body text-fg-subtle">
                Событий пока нет. Журнал ведётся с 5 августа 2026: всё, что было раньше, в него не попало.
              </p>
            ) : (
              <div className="space-y-2">
                {events.map(ev => (
                  <div
                    key={ev.id}
                    className={cn(
                      'flex gap-3 rounded-block border px-3 py-2.5',
                      ev.type === 'signal_failed' ? 'border-danger-border bg-danger-subtle' : 'border-border',
                    )}
                  >
                    <span className="text-micro text-fg-subtle flex-shrink-0 w-28 pt-0.5">
                      {new Date(ev.createdAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <div className="min-w-0">
                      <p className={cn('text-body font-medium', ev.type === 'signal_failed' ? 'text-danger-fg' : 'text-fg')}>
                        {ev.title}
                      </p>
                      {ev.details && <p className="text-micro text-fg-subtle mt-0.5">{ev.details}</p>}
                      {ev.actorLabel && <p className="text-micro text-fg-subtle mt-0.5">Кто: {ev.actorLabel}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>

      <Modal
        open={showDelete}
        onClose={() => { if (!deletingCompany) setShowDelete(false); }}
        title="Удалить компанию навсегда?"
        footer={(
          <>
            <Button variant="ghost" size="md"
              onClick={() => setShowDelete(false)}
              disabled={deletingCompany}
              
            >
              Отмена
            </Button>
            <Button variant="danger" size="md"
              onClick={doDeleteCompany}
              disabled={deletingCompany || deleteInput.trim() !== company.name.trim()}
              
            >
              {deletingCompany ? 'Удаляем…' : 'Удалить навсегда'}
            </Button>
          </>
        )}
      >
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-danger-subtle flex items-center justify-center">
            <Trash2 className="w-5 h-5 text-danger" />
          </div>
          <div className="min-w-0">
            <p className="text-body text-fg-muted mt-1.5">
              Будут стёрты все данные «<strong className="text-fg">{company.name}</strong>»: сотрудники, записи, спринты, аналитика, CRM и договор. Это <strong className="text-fg">необратимо</strong>. Если нужно просто убрать из активных, используйте статус «Закрыта».
            </p>
          </div>
        </div>
        <div className="mt-4">
          <label className="block text-body text-fg-muted mb-1">Введите название компании для подтверждения:</label>
          <Input
            type="text"
            value={deleteInput}
            onChange={(e) => setDeleteInput(e.target.value)}
            placeholder={company.name}
            disabled={deletingCompany}
          />
        </div>
      </Modal>

      {/* Приостановка за неоплату: одно необязательное поле, потому что решение простое и
          принимается быстро. Всё, что нужно сказать перед нажатием, сказано здесь. */}
      <Modal
        open={holdOpen}
        onClose={() => { if (!holdBusy) setHoldOpen(false); }}
        title="Приостановить работу за неоплату"
        footer={(
          <>
            <Button variant="ghost" size="md"
              onClick={() => setHoldOpen(false)}
              disabled={holdBusy}
              
            >
              Отмена
            </Button>
            <Button variant="danger" size="md"
              onClick={saveHold}
              disabled={holdBusy}
              
            >
              {holdBusy ? 'Приостанавливаем…' : 'Приостановить'}
            </Button>
          </>
        )}
      >
        <div className="space-y-4">
          <p className="text-body text-fg-muted">
            Вся команда клиента ({users.length} чел.) при входе увидит экран с объяснением вместо
            платформы: ни менеджеры, ни РОП, ни собственник дальше не пройдут. Записи, разборы и
            настройки сохранятся. Напоминания и отчёты команде на это время не уходят.
          </p>
          <div>
            <label className="block text-body font-medium text-fg-muted mb-1">Что увидит собственник</label>
            <Input
              type="text"
              value={holdNote}
              onChange={(e) => setHoldNote(e.target.value)}
              placeholder="Например: счёт № 14 от 1 августа, оплата до 10 августа"
            />
            <p className="text-micro text-fg-subtle mt-1">
              Поле необязательное. Его текст видит только собственник: РОПу и менеджерам сумму и
              номер счёта не показываем.
            </p>
          </div>
        </div>
      </Modal>

      {/* Пауза с условиями: причина, дата возврата, ответственный. Без них пауза становится
          исчезновением клиента без срока — ровно то, что дало 112 дней тишины у клиента. */}
      <Modal
        open={pauseOpen}
        onClose={() => { if (!pauseBusy) setPauseOpen(false); }}
        title="Поставить работу на паузу"
        footer={(
          <>
            <Button variant="ghost" size="md"
              onClick={() => setPauseOpen(false)}
              disabled={pauseBusy}
              
            >
              Отмена
            </Button>
            <Button
              type="button"
              onClick={savePause}
              disabled={pauseBusy || !pauseReason.trim() || !pauseReturn}
            >
              {pauseBusy ? 'Сохраняем…' : 'Поставить на паузу'}
            </Button>
          </>
        )}
      >
        <div className="space-y-4">
          <p className="text-body text-fg-muted">
            Пауза приглушает сигналы команде клиента, но не выключает наблюдение. В названную дату
            платформа напомнит нам вернуться к компании.
          </p>
          <div>
            <label className="block text-body font-medium text-fg-muted mb-1">Причина <span className="text-danger">*</span></label>
            <Input
              type="text"
              value={pauseReason}
              onChange={(e) => setPauseReason(e.target.value)}
              placeholder="Например: ищут двух менеджеров, работать некому"
            />
          </div>
          <div data-ds-exception="браузерная дата до DateField 0.9.1">
            <label className="block text-body font-medium text-fg-muted mb-1">Планируемая дата возврата <span className="text-danger">*</span></label>
            <Input
              type="date"
              value={pauseReturn}
              onChange={(e) => setPauseReturn(e.target.value)}
            />
            <p className="text-micro text-fg-subtle mt-1">Предельный срок паузы 60 дней: дальше блок считается прерванным и сроки пересчитываются письменно.</p>
          </div>
          <div>
            <label className="block text-body font-medium text-fg-muted mb-1">Ответственный у клиента</label>
            <Input
              type="text"
              value={pauseResponsible}
              onChange={(e) => setPauseResponsible(e.target.value)}
              placeholder="Кто со стороны клиента отвечает за возврат"
            />
          </div>
          <div>
            <label className="block text-body font-medium text-fg-muted mb-1">Что должно случиться, чтобы пауза кончилась</label>
            <Input
              type="text"
              value={pauseCondition}
              onChange={(e) => setPauseCondition(e.target.value)}
              placeholder="Например: наняты два менеджера и вышли на работу"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
