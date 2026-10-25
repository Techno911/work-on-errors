import { useEffect, useState, useRef, useId } from 'react';
import { PageTitle } from '@/components/layout/PageTitle';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Copy, X, UserPlus, Pencil, Check, UserX, UserCheck, UserCog, Plus, Trash2, ArrowLeft, Building2, ChevronRight, Eye, KeyRound, Mail } from 'lucide-react';
import { StaffSummary } from '@/components/admin/StaffSummary';
import { CompanyStatusBadge } from '@/components/admin/CompanyStatusBadge';
import { useAuthStore } from '@/stores/authStore';
import { companiesApi } from '@/api/companies';
import { adminApi, type AdminCompanyMetrics } from '@/api/admin';
import { invitesApi } from '@/api/invites';
import { usersApi } from '@/api/users';
import { DEFAULT_REVIEW_NORMS, type CompanySettings, type UpdateCompanySettingsDto, type User, type Invite, type ReviewTemplate, type ReviewTemplateHistory } from '@/types';
import { cn } from '@/lib/utils';
import { reviewTemplatesApi } from '@/api/review-templates';
import { GamificationPanel } from '@/components/gamification/GamificationPanel';
import { GamificationSettingsPanel } from '@/components/gamification/GamificationSettingsPanel';
import { SettingsPresets } from '@/components/settings/SettingsPresets';
import { RopBonusSettings } from '@/components/settings/RopBonusSettings';
import { TranscriptionSettingsCard } from '@/components/settings/TranscriptionSettingsCard';
import { CrmIntegrationSettings } from '@/components/settings/CrmIntegrationSettings';
import { ChangePasswordCard } from '@/components/settings/ChangePasswordCard';
import { TelegramLinkButton } from '@/components/settings/TelegramLinkButton';
import { Avatar, Button, Switch, Input, Select, Textarea, Badge, Notice, Card, Modal, Tabs, FileField } from '@chirkov/shell';

const RU_TIMEZONES = [
  { value: 'Europe/Kaliningrad', label: 'Калининград (UTC+2)' },
  { value: 'Europe/Moscow', label: 'Москва (UTC+3)' },
  { value: 'Europe/Samara', label: 'Самара (UTC+4)' },
  { value: 'Asia/Yekaterinburg', label: 'Екатеринбург (UTC+5)' },
  { value: 'Asia/Omsk', label: 'Омск (UTC+6)' },
  { value: 'Asia/Krasnoyarsk', label: 'Красноярск (UTC+7)' },
  { value: 'Asia/Irkutsk', label: 'Иркутск (UTC+8)' },
  { value: 'Asia/Yakutsk', label: 'Якутск (UTC+9)' },
  { value: 'Asia/Vladivostok', label: 'Владивосток (UTC+10)' },
  { value: 'Asia/Magadan', label: 'Магадан (UTC+11)' },
  { value: 'Asia/Kamchatka', label: 'Камчатка (UTC+12)' },
];

// Переключатель boolean настройки
function Toggle({ value, onChange, label, description }: {
  value: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
      <div className="min-w-0 flex-1 basis-48">
        <div className="text-body font-medium text-fg">{label}</div>
        {description && <div className="text-micro text-fg-subtle mt-0.5">{description}</div>}
      </div>
      <Switch
        value={value}
        onChange={onChange}
        labels={['Включено', 'Выключено']}
        aria-label={label}
      />
    </div>
  );
}

// Числовой инпут с лейблом
function NumberInput({ label, value, onChange, min = 0, max = 9999, hint, suffix = 'симв.' }: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  hint?: string;
  suffix?: string;
}) {
  const inputId = useId();
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2">
      <div className="min-w-0 flex-1 basis-48">
        <label htmlFor={inputId} className="text-body text-fg-muted">{label}</label>
        {hint && <p className="text-micro text-fg-subtle mt-0.5">{hint}</p>}
      </div>
      <div className="flex items-center gap-1">
        <div className="w-20 text-center">
          <Input
            id={inputId}
            type="number"
            value={value}
            onChange={e => onChange(Math.max(min, Math.min(max, Number(e.target.value))))}
            min={min}
            max={max}
          />
        </div>
        <span className="text-micro text-fg-subtle">{suffix}</span>
      </div>
    </div>
  );
}

const ROLE_LABELS: Record<string, string> = {
  manager: 'Менеджер',
  reviewer: 'РОП',
  owner: 'Владелец',
  superadmin: 'Суперадмин',
};

const USER_ACTIVITY_BADGE_COLOR = {
  active: 'success',
  inactive: 'neutral',
} as const;

// Готовое сообщение с доступом для отправки сотруднику — трекеру не нужно собирать вручную.
// Пароля в сообщении нет: уходит именная ссылка, по которой человек задаёт пароль сам,
// и она гаснет после первого входа (волна 3 разбора жизненного цикла).
function inviteMessage(c: { name: string; email: string; activationUrl: string }): string {
  return `${c.name}, доступ к платформе разбора звонков и переписок.
Ваша личная ссылка входа (живёт 3 дня): ${c.activationUrl}
По ней вы придумаете себе пароль, дальше вход обычный: ${window.location.origin}
Логин: ${c.email}`;
}

/** Редактор списка источников (pills + кнопка добавить) */
function SourceTagsEditor({ label, sources, onChange }: {
  label: string;
  sources: string[];
  onChange: (updated: string[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleAdd = () => {
    const trimmed = inputValue.trim();
    if (!trimmed || sources.includes(trimmed)) return;
    onChange([...sources, trimmed]);
    setInputValue('');
    setAdding(false);
  };

  const handleRemove = (src: string) => {
    if (sources.length <= 1) {
      toast.error('Должен остаться хотя бы один источник', { duration: Infinity });
      return;
    }
    onChange(sources.filter(s => s !== src));
  };

  return (
    <div className="py-3">
      <p className="text-body font-medium text-fg-muted mb-2">{label}</p>
      <div className="flex flex-wrap gap-x-3 gap-y-4">
        {sources.map(src => (
          <Badge key={src} tone="neutral">
            {src}
            <Button
              type="button"
              onClick={() => handleRemove(src)}
              variant="link"
              size="sm"
              title="Удалить источник"
            >
              ×
            </Button>
          </Badge>
        ))}
        {adding ? (
          <div className="flex items-center gap-1">
            <div className="w-32">
              <Input
                ref={inputRef}
                autoFocus
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleAdd();
                  if (e.key === 'Escape') { setAdding(false); setInputValue(''); }
                }}
                placeholder="Название..."
              />
            </div>
            <Button
              type="button"
              onClick={handleAdd}
              disabled={!inputValue.trim()}
              variant="ghost"
              size="sm"
              icon={<Check />}
            />
            <Button
              type="button"
              onClick={() => { setAdding(false); setInputValue(''); }}
              variant="ghost"
              size="sm"
              icon={<X />}
            />
          </div>
        ) : (
          <Button
            type="button"
            onClick={() => setAdding(true)}
            variant="ghost"
            size="sm"
            icon={<Plus />}
          >
            Добавить
          </Button>
        )}
      </div>
    </div>
  );
}

export function SettingsPage() {
  const { user, setUser } = useAuthStore();
  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [settingsCompanyId, setSettingsCompanyId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CompanySettings | null>(null);
  const [teamUsers, setTeamUsers] = useState<User[]>([]);
  const [pendingInvites, setPendingInvites] = useState<Invite[]>([]);
  // Учётки, созданные импортом из CRM. Живут на уровне страницы (а не внутри
  // вкладки «Интеграции»), чтобы пароли не пропадали при переключении вкладок.
  const [importedCreds, setImportedCreds] = useState<{ name: string; email: string; activationUrl: string }[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  // Шаблоны ревью
  const [reviewTemplates, setReviewTemplates] = useState<ReviewTemplate[]>([]);
  const [editingTemplate, setEditingTemplate] = useState<ReviewTemplate | null>(null);
  const [editingTemplateName, setEditingTemplateName] = useState('');
  const [editingTemplateContent, setEditingTemplateContent] = useState('');
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [historyTemplate, setHistoryTemplate] = useState<ReviewTemplate | null>(null);
  const [templateHistory, setTemplateHistory] = useState<ReviewTemplateHistory[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [showCreateTemplate, setShowCreateTemplate] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [newTemplateContent, setNewTemplateContent] = useState('');
  // Шаблоны ревью для reviewer доступны только если собственник включил reviewerCanEditReviewTemplates.
  // Owner/superadmin видят всегда.
  const canEditTemplates =
    user?.role === 'owner' ||
    user?.role === 'superadmin' ||
    (user?.role === 'reviewer' &&
      settingsCompanyId === user.companyId &&
      settings?.reviewerCanEditReviewTemplates === true);

  // id-префикс для связки label↔input (доступность, автозаполнение)
  const fid = useId();
  const reportEmailsId = `${fid}-report-emails`;
  const reportTelegramId = `${fid}-report-telegram`;
  const inviteNameId = `${fid}-invite-name`;
  const inviteEmailId = `${fid}-invite-email`;
  const inviteRoleId = `${fid}-invite-role`;

  // Avatar upload
  const [avatarUploading, setAvatarUploading] = useState(false);
  const uploadAvatar = async (file: File) => {
    if (!user) return;
    if (!file.type.startsWith('image/')) { toast.error('Только изображения', { duration: Infinity }); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error('Максимальный размер: 5 МБ', { duration: Infinity }); return; }
    setAvatarUploading(true);
    try {
      const { data } = await usersApi.uploadAvatar(user.id, file);
      setUser({ ...user, avatarUrl: data.avatarUrl });
      toast.success('Фото обновлено');
    } catch {
      toast.error('Не удалось загрузить фото', { duration: Infinity });
    } finally {
      setAvatarUploading(false);
    }
  };

  // Profile edit state
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(user?.fullName ?? '');
  const [savingName, setSavingName] = useState(false);

  // Deactivate / delete confirmation state
  const [confirmDeactivate, setConfirmDeactivate] = useState<string | null>(null);
  const [confirmRole, setConfirmRole] = useState<string | null>(null);
  const [confirmHardDelete, setConfirmHardDelete] = useState<string | null>(null);

  // Суперадмин: те же действия над сотрудником, что и в карточке компании —
  // возможности не должны зависеть от того, каким путём открыли команду
  const startImpersonation = useAuthStore(s => s.startImpersonation);
  const [adminBusyId, setAdminBusyId] = useState<string | null>(null);
  const [resetResult, setResetResult] = useState<{ userId: string; password: string } | null>(null);

  const handleImpersonate = async (userId: string) => {
    setAdminBusyId(userId);
    try {
      const { data } = await adminApi.impersonate(userId);
      startImpersonation(data.accessToken, data.user);
      navigate('/dashboard');
    } catch {
      toast.error('Не удалось войти от имени сотрудника', { duration: Infinity });
    } finally {
      setAdminBusyId(null);
    }
  };

  const handleAdminResetPassword = async (userId: string) => {
    if (!window.confirm('Сбросить пароль этому сотруднику? Старый пароль перестанет работать.')) return;
    setAdminBusyId(userId);
    try {
      const { data } = await adminApi.resetUserPassword(userId);
      setResetResult({ userId, password: data.newPassword });
    } catch {
      toast.error('Не удалось сбросить пароль', { duration: Infinity });
    } finally {
      setAdminBusyId(null);
    }
  };

  // Invite modal state
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteFullName, setInviteFullName] = useState('');
  const [inviteRole, setInviteRole] = useState('manager');
  const [sendingInvite, setSendingInvite] = useState(false);
  const [createdInviteLink, setCreatedInviteLink] = useState<string | null>(null);

  // Superadmin управляет любой компанией через ?companyId= (паттерн как в Analytics/SprintBoard);
  // для остальных ролей query param игнорируется — только своя компания.
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const isSuperadmin = user?.role === 'superadmin';
  const companyId = isSuperadmin ? (searchParams.get('companyId') ?? '') : (user?.companyId ?? '');
  const canEdit = user?.role === 'owner' || user?.role === 'superadmin';
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [adminCompanies, setAdminCompanies] = useState<AdminCompanyMetrics[]>([]);

  // Superadmin без выбранной компании — список компаний для выбора
  useEffect(() => {
    if (!isSuperadmin || companyId) return;
    adminApi.getCompanies()
      .then(({ data }) => setAdminCompanies(data ?? []))
      .catch(() => {});
  }, [isSuperadmin, companyId]);

  // Имя компании в шапке (контекст для superadmin)
  useEffect(() => {
    if (!isSuperadmin || !companyId) { setCompanyName(null); return; }
    companiesApi.getById(companyId)
      .then(({ data }) => setCompanyName(data.name))
      .catch(() => setCompanyName(null));
  }, [isSuperadmin, companyId]);

  useEffect(() => {
    setSettingsCompanyId(null);
    if (!companyId) { setLoading(false); return; }
    let active = true;
    const load = async () => {
      try {
        const [settingsRes, usersRes] = await Promise.all([
          companiesApi.getSettings(companyId),
          companiesApi.getUsers(companyId),
        ]);
        if (!active) return;
        setSettings(settingsRes.data);
        setSettingsCompanyId(companyId);
        setDraft(settingsRes.data);
        setTeamUsers(usersRes.data);
      } catch {
        if (active) setError('Не удалось загрузить настройки');
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    // Load pending invites separately (non-blocking)
    if (canEdit) {
      invitesApi.getByCompany(companyId)
        .then(({ data }) => setPendingInvites(data.filter(i => i.status === 'pending')))
        .catch(() => {});
    }
    return () => { active = false; };
  }, [companyId, canEdit]);

  useEffect(() => {
    setReviewTemplates([]);
    if (!companyId || !canEditTemplates) return;
    let active = true;
    reviewTemplatesApi.getAll(companyId)
      .then(({ data }) => { if (active) setReviewTemplates(data); })
      .catch(() => { if (active) setReviewTemplates([]); });
    return () => { active = false; };
  }, [companyId, canEditTemplates]);

  const updateDraft = (patch: Partial<CompanySettings>) => {
    setDraft(prev => prev ? { ...prev, ...patch } : null);
    setSaved(false);
  };

  const handleSave = async () => {
    if (!draft || !companyId) return;
    setSaving(true);
    setError('');
    try {
      await companiesApi.update(companyId, draft as UpdateCompanySettingsDto);
      setSettings(draft);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError('Не удалось сохранить настройки');
    } finally {
      setSaving(false);
    }
  };

  const handleSendInvite = async () => {
    if (!inviteEmail.trim() || !companyId) return;
    setSendingInvite(true);
    setCreatedInviteLink(null);
    try {
      const { data } = await invitesApi.create({
        email: inviteEmail.trim(),
        fullName: inviteFullName.trim() || undefined,
        role: inviteRole,
        companyId,
      });
      const link = `${window.location.origin}/invite/${data.code}`;
      setCreatedInviteLink(link);
      setPendingInvites(prev => [...prev, data]);
      setInviteEmail('');
      setInviteFullName('');
      toast.success('Приглашение создано! Скопируйте ссылку и отправьте сотруднику.');
    } catch {
      toast.error('Не удалось создать ссылку-приглашение. Попробуйте ещё раз', { duration: Infinity });
    } finally {
      setSendingInvite(false);
    }
  };

  const handleCopyLink = (link: string) => {
    navigator.clipboard.writeText(link).then(() => {
      toast.success('Ссылка скопирована');
    }).catch(() => {
      toast.error('Не удалось скопировать', { duration: Infinity });
    });
  };

  const handleCloseModal = () => {
    setShowInviteModal(false);
    setInviteEmail('');
    setInviteFullName('');
    setInviteRole('manager');
    setCreatedInviteLink(null);
  };

  const handleSaveName = async () => {
    if (!user || !nameInput.trim() || nameInput.trim() === user.fullName) {
      setEditingName(false);
      return;
    }
    setSavingName(true);
    try {
      const { data } = await usersApi.update(user.id, { fullName: nameInput.trim() });
      setUser({ ...user, fullName: data.fullName });
      setEditingName(false);
      toast.success('Имя обновлено');
    } catch {
      toast.error('Не удалось обновить имя', { duration: Infinity });
    } finally {
      setSavingName(false);
    }
  };

  /**
   * Смена роли между менеджером и РОПом.
   *
   * Заведено 16.09.2026 по вопросу владельца клиента «как мне там изменить роль с РОПа на
   * обычного менеджера»: ответа в продукте не было вовсе, хотя сервер такую правку
   * владельцу разрешал всегда. Роль меняется на месте, в карточке человека, потому что
   * решение принимают именно про человека, а не про настройку компании.
   */
  const handleChangeRole = async (targetUser: User) => {
    const nextRole = targetUser.role === 'reviewer' ? 'manager' : 'reviewer';
    setConfirmRole(null);
    try {
      await usersApi.update(targetUser.id, { role: nextRole });
      setTeamUsers(prev => prev.map(u => u.id === targetUser.id ? { ...u, role: nextRole } : u));
      toast.success(`${targetUser.fullName} теперь ${nextRole === 'reviewer' ? 'РОП' : 'менеджер'}`);
    } catch {
      toast.error('Не удалось изменить роль', { duration: Infinity });
    }
  };

  const handleToggleActive = async (targetUser: User) => {
    const newActive = !targetUser.isActive;
    setConfirmDeactivate(null);
    try {
      await usersApi.update(targetUser.id, { isActive: newActive });
      setTeamUsers(prev => prev.map(u => u.id === targetUser.id ? { ...u, isActive: newActive } : u));
      toast.success(newActive ? `${targetUser.fullName} активирован` : `${targetUser.fullName} деактивирован`);
    } catch {
      toast.error('Не удалось изменить статус', { duration: Infinity });
    }
  };

  const handleHardDelete = async (targetUser: User) => {
    setConfirmHardDelete(null);
    try {
      await usersApi.hardDelete(targetUser.id);
      setTeamUsers(prev => prev.filter(u => u.id !== targetUser.id));
      toast.success(`${targetUser.fullName} удалён. Email ${targetUser.email} свободен для нового приглашения.`);
    } catch {
      toast.error('Не удалось удалить пользователя', { duration: Infinity });
    }
  };

  const hasChanges = JSON.stringify(draft) !== JSON.stringify(settings);

  // Действующие РОПы компании: премия считается по компании, но решение про неё владелец
  // принимает про человека, поэтому имена нужны и в настройках премии, и в смене роли.
  const activeRopNames = teamUsers
    .filter(u => u.role === 'reviewer' && u.isActive)
    .map(u => u.fullName)
    .filter((n): n is string => Boolean(n));
  const bonusOn = settings?.ropBonus?.enabled === true;
  // Вкладка живёт в URL (?tab=norms): F5 не сбрасывает, ссылкой можно открыть конкретный раздел
  type SettingsTab = 'profile' | 'norms' | 'sources' | 'gamification' | 'templates' | 'integrations' | 'team';
  const TAB_IDS: SettingsTab[] = ['profile', 'norms', 'sources', 'gamification', 'templates', 'integrations', 'team'];
  const tabFromUrl = searchParams.get('tab') as SettingsTab | null;
  const [activeTab, setActiveTabState] = useState<SettingsTab>(
    tabFromUrl && TAB_IDS.includes(tabFromUrl) ? tabFromUrl : (isSuperadmin && companyId ? 'norms' : 'profile'),
  );
  const setActiveTab = (tab: SettingsTab) => {
    setActiveTabState(tab);
    const next = new URLSearchParams(searchParams);
    next.set('tab', tab);
    setSearchParams(next, { replace: true });
  };
  useEffect(() => {
    if (!isSuperadmin) return;
    // Компания выбрана, а активна вкладка «Профиль» (личный аккаунт) — увести на «Нормативы»,
    // иначе контентная область останется пустой (таб-кнопка «Профиль» здесь скрыта).
    if (companyId && activeTab === 'profile') { setActiveTab('norms'); return; }
    if (!tabFromUrl) setActiveTabState(companyId ? 'norms' : 'profile');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuperadmin, companyId]);

  // Deep-link к секции внутри вкладки (?section=): CTA из карточки готовности
  // прокручивает прямо к нужному блоку и коротко подсвечивает его, чтобы не искать.
  const sectionParam = searchParams.get('section');
  const [flashSection, setFlashSection] = useState<string | null>(null);
  useEffect(() => {
    if (!sectionParam) return;
    const t = setTimeout(() => {
      const el = document.getElementById('section-' + sectionParam);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setFlashSection(sectionParam);
      }
    }, 200);
    const t2 = setTimeout(() => setFlashSection(null), 2400);
    return () => { clearTimeout(t); clearTimeout(t2); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionParam, activeTab, draft]);

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="h-8 bg-border rounded-card w-36 animate-pulse" />
        {[1, 2, 3].map(i => (
          <Card key={i} padding="md" className="space-y-4">
            <div className="h-5 bg-border rounded-chip w-32 animate-pulse" />
            <div className="space-y-3">
              <div className="h-9 bg-surface-sunken rounded-card animate-pulse" />
              <div className="h-9 bg-surface-sunken rounded-card animate-pulse" />
            </div>
          </Card>
        ))}
      </div>
    );
  }

  if (!canEdit) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <p className="text-fg-subtle mt-1 text-body">Ваш профиль</p>
        </div>
        {/* Profile card for non-owners */}
        <Card padding="md">
          <h2 className="text-body-lg font-semibold text-fg mb-4">Мой профиль</h2>
          <div className="flex flex-col gap-4">
            <FileField
              variant="avatar"
              label="Фото профиля"
              hint="Квадрат кадрируется по центру, до 5 МБ"
              accept="image/*"
              disabled={avatarUploading}
              avatarPreview={user?.avatarUrl ?? undefined}
              avatarFallback={(user?.fullName ?? "?").slice(0, 1).toUpperCase()}
              onAvatarChange={({ file }) => uploadAvatar(file)}
            />
            <div className="flex-1 min-w-0">
              {editingName ? (
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <Input
                      autoFocus
                      value={nameInput}
                      onChange={e => setNameInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleSaveName(); if (e.key === 'Escape') setEditingName(false); }}
                      maxLength={80}
                    />
                  </div>
                  <Button onClick={handleSaveName} disabled={savingName} variant="primary" size="sm" icon={<Check />} />
                  <Button onClick={() => setEditingName(false)} variant="ghost" size="sm" icon={<X />} />
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <p className="text-body-lg font-semibold text-fg">{user?.fullName}</p>
                  <Button onClick={() => { setNameInput(user?.fullName ?? ''); setEditingName(true); }} variant="ghost" size="sm" icon={<Pencil />} />
                </div>
              )}
              <p className="text-body text-fg-subtle mt-0.5">{user?.email}</p>
              <p className="text-micro text-fg-subtle mt-0.5">{ROLE_LABELS[user?.role ?? ''] ?? user?.role}</p>
            </div>
          </div>
        </Card>
        {/* Геймификация для reviewer (если owner разрешил) */}
        {user?.role === 'reviewer' && settings?.reviewerCanEditGamification && (
          <Card padding="md">
            <div className="flex items-center justify-between mb-1">
              <div>
                <h2 className="text-body-lg font-semibold text-fg">Геймификация</h2>
                <p className="text-micro text-fg-subtle mt-0.5">Управление системой XP и достижений для менеджеров</p>
              </div>
            </div>
            <div className="flex items-center justify-between pt-4 border-t border-border mt-4">
              <div>
                <p className="text-body font-medium text-fg">Геймификация включена</p>
                <p className="text-micro text-fg-subtle mt-0.5">Менеджеры видят XP, уровни и достижения</p>
              </div>
              <Button
                type="button"
                onClick={async () => {
                  const newVal = !(settings?.gamificationEnabled ?? true);
                  try {
                    await companiesApi.updateGamification(companyId, { gamificationEnabled: newVal });
                    setSettings(prev => prev ? { ...prev, gamificationEnabled: newVal } : prev);
                    toast.success(newVal ? 'Геймификация включена' : 'Геймификация отключена');
                  } catch { toast.error('Не удалось сохранить', { duration: Infinity }); }
                }}
                variant={settings?.gamificationEnabled !== false ? 'primary' : 'secondary'}
                size="sm"
                role="switch"
                aria-checked={settings?.gamificationEnabled !== false}
              >
                {settings?.gamificationEnabled !== false ? 'Включено' : 'Выключено'}
              </Button>
            </div>
          </Card>
        )}
        {settings?.gamificationEnabled !== false && settings?.reviewerCanEditGamification && user?.role === 'reviewer' && (
          <GamificationSettingsPanel companyId={companyId} />
        )}
        <Card padding="md">
          <h2 className="text-body-lg font-semibold text-fg mb-4">Безопасность</h2>
          <ChangePasswordCard />
        </Card>

        {/* === Шаблоны ревью для РОПа === */}
        {canEditTemplates && (
          <Card padding="md">
            <div className="flex flex-col items-stretch gap-3 mb-4 min-[480px]:flex-row min-[480px]:items-center min-[480px]:justify-between">
              <div>
                <h2 className="text-body-lg font-semibold text-fg">Шаблоны ревью</h2>
                <p className="text-micro text-fg-subtle mt-0.5">Заготовки текста для обратной связи менеджерам</p>
              </div>
              <Button
                type="button"
                onClick={() => { setShowCreateTemplate(true); setNewTemplateName(''); setNewTemplateContent(''); }}
                icon={<Plus />}
              >
                Создать шаблон
              </Button>
            </div>

            <div className="space-y-2">
              {reviewTemplates.length === 0 && (
                <p className="text-body text-fg-subtle py-2">Нет шаблонов. Создайте первый!</p>
              )}
              {reviewTemplates.map(tpl => (
                <div key={tpl.id} className="flex flex-wrap items-start justify-between gap-3 p-3 rounded-block border border-border hover:border-border transition-colors">
                  <div className="flex-1 min-w-48">
                    <p className="text-body font-medium text-fg">{tpl.name}</p>
                    <p className="text-micro text-fg-subtle mt-0.5">
                      v{tpl.version} · {tpl.createdByName ? `изменён ${tpl.createdByName}` : 'создан'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 max-w-full">
                    <Button
                      type="button"
                      onClick={async () => {
                        setHistoryTemplate(tpl);
                        setLoadingHistory(true);
                        try {
                          const { data } = await reviewTemplatesApi.getHistory(companyId, tpl.id);
                          setTemplateHistory(data);
                        } catch {
                          setTemplateHistory([]);
                        } finally {
                          setLoadingHistory(false);
                        }
                      }}
                      variant="link"
                      size="sm"
                    >
                      История
                    </Button>
                    <Button
                      type="button"
                      onClick={() => {
                        setEditingTemplate(tpl);
                        setEditingTemplateName(tpl.name);
                        setEditingTemplateContent(tpl.content);
                      }}
                      variant="link"
                      size="sm"
                    >
                      Редактировать
                    </Button>
                    <Button
                      type="button"
                      onClick={async () => {
                        if (!window.confirm(`Удалить шаблон «${tpl.name}»? Шаблон пропадёт из списка и формы ревью; уже написанные ревью не изменятся.`)) return;
                        try {
                          await reviewTemplatesApi.deactivate(companyId, tpl.id);
                          setReviewTemplates(prev => prev.filter(t => t.id !== tpl.id));
                          toast.success('Шаблон удалён');
                        } catch {
                          toast.error('Не удалось удалить шаблон', { duration: Infinity });
                        }
                      }}
                      variant="ghost"
                      size="sm"
                      title="Удалить"
                      icon={<X />}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Форма создания */}
            {showCreateTemplate && (
              <div className="mt-4 p-4 border border-accent-muted rounded-block bg-accent-subtle space-y-3">
                <h3 className="text-body font-semibold text-fg">Новый шаблон</h3>
                <Input
                  type="text"
                  value={newTemplateName}
                  onChange={e => setNewTemplateName(e.target.value)}
                  placeholder="Название шаблона..."
                />
                <Textarea resize="none"
                  value={newTemplateContent}
                  onChange={e => setNewTemplateContent(e.target.value)}
                  placeholder="Текст шаблона..."
                  rows={5}
                />
                <div className="flex gap-2 justify-end">
                  <Button type="button" onClick={() => setShowCreateTemplate(false)} variant="ghost" size="sm">Отмена</Button>
                  <Button
                    type="button"
                    disabled={!newTemplateName.trim() || newTemplateContent.trim().length < 10}
                    onClick={async () => {
                      setSavingTemplate(true);
                      try {
                        const { data } = await reviewTemplatesApi.create(companyId, { name: newTemplateName.trim(), content: newTemplateContent.trim() });
                        setReviewTemplates(prev => [...prev, data]);
                        setShowCreateTemplate(false);
                        toast.success('Шаблон создан');
                      } catch {
                        toast.error('Не удалось создать шаблон', { duration: Infinity });
                      } finally {
                        setSavingTemplate(false);
                      }
                    }}
                    size="sm"
                  >
                    {savingTemplate ? 'Сохраняем…' : 'Создать'}
                  </Button>
                </div>
              </div>
            )}

            {/* Модал редактирования */}
            {editingTemplate && (
              <Modal
                size="md"
                open
                onClose={() => setEditingTemplate(null)}
                title="Редактировать шаблон"
                footer={(
                  <>
                    <Button type="button" onClick={() => setEditingTemplate(null)} variant="ghost" size="md">Отмена</Button>
                    <Button
                      type="button"
                      disabled={!editingTemplateName.trim() || editingTemplateContent.trim().length < 10 || savingTemplate}
                      onClick={async () => {
                        setSavingTemplate(true);
                        try {
                          const { data } = await reviewTemplatesApi.update(companyId, editingTemplate.id, { name: editingTemplateName.trim(), content: editingTemplateContent.trim() });
                          setReviewTemplates(prev => prev.map(t => t.id === data.id ? data : t));
                          setEditingTemplate(null);
                          toast.success('Шаблон обновлён');
                        } catch {
                          toast.error('Не удалось сохранить', { duration: Infinity });
                        } finally {
                          setSavingTemplate(false);
                        }
                      }}
                      size="md"
                    >
                      {savingTemplate ? 'Сохраняем…' : 'Сохранить'}
                    </Button>
                  </>
                )}
              >
                <div className="space-y-4">
                  <Input type="text" value={editingTemplateName} onChange={e => setEditingTemplateName(e.target.value)} />
                  <Textarea resize="none" value={editingTemplateContent} onChange={e => setEditingTemplateContent(e.target.value)} rows={8} />
                </div>
              </Modal>
            )}

            {/* Модал истории */}
            {historyTemplate && (
              <Modal
                size="md"
                open
                onClose={() => setHistoryTemplate(null)}
                title={`История: ${historyTemplate.name}`}
              >
                <div className="space-y-3">
                  {loadingHistory && <p className="text-body text-fg-subtle animate-pulse">Загрузка...</p>}
                  {!loadingHistory && templateHistory.length === 0 && <p className="text-body text-fg-subtle">История изменений пуста</p>}
                  {templateHistory.map(h => (
                    <div key={h.id} className="border border-border rounded-block p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-micro font-semibold text-accent-hover">v{h.version}</span>
                        <span className="text-micro text-fg-subtle">{new Date(h.changedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })} · {h.changedByName}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-micro">
                        <div><p className="text-fg-subtle mb-1">Было:</p><p className="text-fg-muted line-clamp-3 bg-canvas rounded-chip p-1.5">{h.previousContent.slice(0, 120)}…</p></div>
                        <div><p className="text-fg-subtle mb-1">Стало:</p><p className="text-fg-muted line-clamp-3 bg-success-subtle rounded-chip p-1.5">{h.newContent.slice(0, 120)}…</p></div>
                      </div>
                    </div>
                  ))}
                </div>
              </Modal>
            )}
          </Card>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        {isSuperadmin && companyId && (
          <div className="mb-2">
            <Button
              type="button"
              onClick={() => navigate(`/admin/company/${companyId}`)}
              variant="link"
              size="sm"
              icon={<ArrowLeft />}
            >
              Карточка компании
            </Button>
          </div>
        )}
        <PageTitle text={isSuperadmin && companyName ? `Настройки · ${companyName}` : undefined} />
        <p className="text-fg-subtle mt-1 text-body">
          {isSuperadmin && companyId
            ? 'Вы настраиваете компанию клиента как суперадмин'
            : 'Управление нормативами и качеством работы команды'}
        </p>
      </div>

      {/* Superadmin без выбранной компании: вместо пустых табов — выбор компании */}
      {isSuperadmin && !companyId && (
        <Card padding="md">
          <h2 className="text-body-lg font-semibold text-fg mb-1">Выберите компанию</h2>
          <p className="text-micro text-fg-subtle mb-3">
            Откроется карточка компании, единое место управления: статус, онбординг, договор, чат, команда. Нормативы и качество тоже там, кнопкой «Настройки».
          </p>
          <div className="divide-y divide-border">
            {adminCompanies.map(c => (
              <Button
                key={c.id}
                type="button"
                onClick={() => navigate(`/admin/company/${c.id}`)}
                variant="ghost"
                size="md"
                fullWidth
                title="Открыть карточку компании"
                icon={<Building2 className="text-accent" />}
              >
                <span className="flex items-center gap-3 w-full text-left font-normal">
                  <span className="min-w-0 text-body font-medium text-fg truncate">{c.name}</span>
                  <CompanyStatusBadge status={c.status} />
                  <StaffSummary managers={c.managersCount} reviewers={c.reviewersCount} owners={c.ownersCount} className="ml-auto text-micro text-fg-subtle flex-shrink-0" />
                  <ChevronRight className="w-4 h-4 text-border flex-shrink-0" />
                </span>
              </Button>
            ))}
            {adminCompanies.length === 0 && (
              <p className="text-body text-fg-subtle py-3">Компаний пока нет. Создайте первую на Главной.</p>
            )}
          </div>
        </Card>
      )}

      {/* Tab navigation (superadmin без компании видит только выбор компании + профиль) */}
      {(!isSuperadmin || !!companyId) && (
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
        <Tabs.List ariaLabel="Разделы настроек">
          {[
            { id: 'profile', label: 'Профиль' },
            { id: 'norms', label: 'Нормативы' },
            { id: 'sources', label: 'Источники' },
            { id: 'gamification', label: 'Геймификация' },
            { id: 'templates', label: 'Шаблоны' },
            { id: 'integrations', label: 'Интеграции' },
            { id: 'team', label: 'Команда' },
          ]
            // Профиль — личный аккаунт суперадмина, не часть настроек компании клиента:
            // внутри карточки конкретной компании эта вкладка только путает.
            .filter(tab => !(tab.id === 'profile' && isSuperadmin && companyId))
            .map(tab => (
              <Tabs.Tab key={tab.id} value={tab.id}>{tab.label}</Tabs.Tab>
            ))}
        </Tabs.List>
      </Tabs>
      )}

      {error && (
        <div className="bg-danger-subtle border border-danger-border rounded-block px-4 py-3 text-body text-danger-fg">{error}</div>
      )}

      {/* Пароли импортированных из CRM сотрудников — стойкий блок на уровне страницы:
          переживает переключение вкладок, закрывается только вручную. Пароли также
          всегда доступны в «Команде» через кнопку «Пароль», так что ничего не теряется. */}
      {importedCreds && importedCreds.length > 0 && (
        <div className="bg-success-subtle border border-success-border rounded-card p-4">
          <div className="flex items-start justify-between gap-3 mb-2">
            <p className="text-body text-fg-muted">
              Добавлено сотрудников: <b className="text-fg">{importedCreds.length}</b>. Отправьте каждому готовое сообщение со ссылкой входа (кнопка отправки рядом). Ссылка живёт 3 дня, новую можно выслать во вкладке «Команда».
            </p>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Button
                type="button"
                onClick={() => { navigator.clipboard?.writeText(importedCreds.map(inviteMessage).join('\n\n· · ·\n\n')); toast.success('Сообщения для всех скопированы'); }}
                variant="link"
                size="sm"
                icon={<Copy />}
              >
                Скопировать все сообщения
              </Button>
              <Button type="button" onClick={() => setImportedCreds(null)} aria-label="Скрыть" variant="ghost" size="sm" icon={<X />} />
            </div>
          </div>
          <div className="space-y-1">
            {importedCreds.map(c => (
              <Card key={c.email} padding="none" tone="success">
                <div className="flex items-center gap-2 text-micro px-2.5 py-1.5">
                <span className="font-medium text-fg truncate flex-1 min-w-0">{c.name}</span>
                <span className="text-fg-subtle truncate hidden sm:inline">{c.email}</span>
                <code className="font-mono text-fg bg-surface-sunken rounded-chip px-1.5 py-0.5 truncate max-w-[220px]">{c.activationUrl}</code>
                <Button
                  type="button"
                  onClick={() => { navigator.clipboard?.writeText(inviteMessage(c)); toast.success('Сообщение с доступом скопировано'); }}
                  variant="link"
                  size="sm"
                  icon={<Mail />}
                >
                  Сообщение
                </Button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* === Мой профиль === */}
      {/* Это личный аккаунт суперадмина — показываем только вне контекста конкретной
          компании клиента (companyId), иначе выглядит как «профиль компании». */}
      {activeTab === 'profile' && !(isSuperadmin && companyId) && (
      <Card padding="md">
        <h2 className="text-body-lg font-semibold text-fg mb-4">Мой профиль</h2>
        <div className="flex flex-col gap-4">
          <FileField
            variant="avatar"
            label="Фото профиля"
            hint="Квадрат кадрируется по центру, до 5 МБ"
            accept="image/*"
            disabled={avatarUploading}
            avatarPreview={user?.avatarUrl ?? undefined}
            avatarFallback={(user?.fullName ?? "?").slice(0, 1).toUpperCase()}
            onAvatarChange={({ file }) => uploadAvatar(file)}
          />
          <div className="flex-1 min-w-0">
            {editingName ? (
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <Input
                    autoFocus
                    value={nameInput}
                    onChange={e => setNameInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleSaveName(); if (e.key === 'Escape') setEditingName(false); }}
                    maxLength={80}
                  />
                </div>
                <Button onClick={handleSaveName} disabled={savingName} variant="primary" size="sm" icon={<Check />} />
                <Button onClick={() => setEditingName(false)} variant="ghost" size="sm" icon={<X />} />
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <p className="text-body-lg font-semibold text-fg">{user?.fullName}</p>
                <Button onClick={() => { setNameInput(user?.fullName ?? ''); setEditingName(true); }} variant="ghost" size="sm" title="Редактировать имя" icon={<Pencil />} />
              </div>
            )}
            <p className="text-body text-fg-subtle mt-0.5">{user?.email}</p>
            <p className="text-micro text-fg-subtle mt-0.5">{ROLE_LABELS[user?.role ?? ''] ?? user?.role}</p>
          </div>
        </div>
      </Card>
      )}

      {/* === Геймификация (настройки для владельца) === */}
      {activeTab === 'gamification' && draft && (
        <Card padding="md">
          <div className="mb-4">
            <h2 className="text-body-lg font-semibold text-fg">Геймификация</h2>
            <p className="text-micro text-fg-subtle mt-0.5">Система XP, уровней и достижений для менеджеров</p>
          </div>
          <div className="divide-y divide-border space-y-0">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-4">
              <div className="min-w-0 flex-1 basis-48">
                <p className="text-body font-medium text-fg">Геймификация включена</p>
                <p className="text-micro text-fg-subtle mt-0.5">Менеджеры видят XP, уровни, серияи и достижения на дашборде</p>
              </div>
              <Button
                type="button"
                onClick={async () => {
                  const newVal = !(draft.gamificationEnabled ?? true);
                  updateDraft({ gamificationEnabled: newVal });
                  try {
                    await companiesApi.updateGamification(companyId, { gamificationEnabled: newVal });
                    toast.success(newVal ? 'Геймификация включена' : 'Геймификация отключена');
                  } catch { toast.error('Не удалось сохранить', { duration: Infinity }); updateDraft({ gamificationEnabled: !newVal }); }
                }}
                variant={draft.gamificationEnabled !== false ? 'primary' : 'secondary'}
                size="sm"
                role="switch"
                aria-checked={draft.gamificationEnabled !== false}
              >
                {draft.gamificationEnabled !== false ? 'Включено' : 'Выключено'}
              </Button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-4">
              <div className="min-w-0 flex-1 basis-48">
                <p className="text-body font-medium text-fg">РОП может управлять геймификацией</p>
                <p className="text-micro text-fg-subtle mt-0.5">Разрешить РОПу включать и отключать геймификацию в своих настройках</p>
              </div>
              <Button
                type="button"
                onClick={async () => {
                  const newVal = !(draft.reviewerCanEditGamification ?? false);
                  updateDraft({ reviewerCanEditGamification: newVal });
                  try {
                    await companiesApi.updateGamification(companyId, { reviewerCanEditGamification: newVal });
                    toast.success(newVal ? 'РОП может управлять геймификацией' : 'Доступ РОПа отозван');
                  } catch { toast.error('Не удалось сохранить', { duration: Infinity }); updateDraft({ reviewerCanEditGamification: !newVal }); }
                }}
                variant={draft.reviewerCanEditGamification ? 'primary' : 'secondary'}
                size="sm"
                role="switch"
                aria-checked={draft.reviewerCanEditGamification}
              >
                {draft.reviewerCanEditGamification ? 'Включено' : 'Выключено'}
              </Button>
            </div>
          </div>
        </Card>
      )}
      {activeTab === 'gamification' && draft?.gamificationEnabled !== false && (
        <GamificationSettingsPanel companyId={companyId} />
      )}

      {draft && activeTab === 'norms' && (
        <>
          {/* === Пресеты быстрого старта (только owner/superadmin) === */}
          {canEdit && (
            <SettingsPresets
              companyId={companyId}
              current={draft as unknown as Record<string, unknown>}
              onApplied={async () => {
                // Перезагружаем настройки чтобы UI отразил новые значения
                try {
                  const { data } = await companiesApi.getSettings(companyId);
                  setSettings(data);
                  setDraft(data);
                } catch { /* ignore */ }
              }}
            />
          )}

          {/* === Нормативы === */}
          <Card padding="md">
            <h2 className="text-body-lg font-semibold text-fg mb-4">Нормативы спринта</h2>

            {/* Часовой пояс: граница недели, дедлайны и утренние отчёты — по местному времени клиента */}
            <div className="mb-4">
              <label htmlFor="company-timezone" className="block text-body font-medium text-fg-muted mb-1">Часовой пояс компании</label>
              <div className="w-full max-w-xs">
                <Select
                  id="company-timezone"
                  value={draft.timezone ?? 'Europe/Moscow'}
                  onChange={e => updateDraft({ timezone: e.target.value })}
                >
                  {RU_TIMEZONES.map(tz => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
                </Select>
              </div>
              <p className="text-micro text-fg-subtle mt-1">Начало недели, дедлайны и утренние отчёты считаются по этому времени.</p>
            </div>

            <div className="divide-y divide-border">
              <div className="pb-4">
                <Toggle
                  value={draft.callsEnabled}
                  onChange={v => updateDraft({ callsEnabled: v })}
                  label="Звонки"
                  description="Менеджеры загружают транскрипции звонков"
                />
                {draft.callsEnabled && (
                  <div className="ml-4 mt-1">
                    <NumberInput
                      label="Норматив звонков в неделю"
                      value={draft.callsPerWeek}
                      onChange={v => updateDraft({ callsPerWeek: v })}
                      min={1}
                      max={50}
                      suffix="шт."
                    />
                  </div>
                )}
              </div>

              <div className="pt-4">
                <Toggle
                  value={draft.chatsEnabled}
                  onChange={v => updateDraft({ chatsEnabled: v })}
                  label="Переписки"
                  description="Менеджеры загружают скриншоты переписок"
                />
                {draft.chatsEnabled && (
                  <div className="ml-4 mt-1">
                    <NumberInput
                      label="Норматив переписок в неделю"
                      value={draft.chatsPerWeek}
                      onChange={v => updateDraft({ chatsPerWeek: v })}
                      min={1}
                      max={50}
                      suffix="шт."
                    />
                  </div>
                )}
              </div>
            </div>

            <p className="text-micro text-fg-subtle mt-4">
              Если тип отключён, соответствующие вкладки не отображаются у менеджеров
            </p>
          </Card>

          {/* === Пороги молодец/красавчик === */}
          <Card padding="md">
            <h2 className="text-body-lg font-semibold text-fg mb-1">Пороги «Молодец / Красавчик»</h2>
            <p className="text-micro text-fg-subtle mb-4">
              Молодец: достиг нормы &nbsp;🟢&nbsp; Красавчик: превысил план &nbsp;🏅
            </p>
            <div className="divide-y divide-border">
              {draft.callsEnabled && (
                <div className="pb-4">
                  <h3 className="text-body font-medium text-fg-muted mb-1">📞 Звонки</h3>
                  <NumberInput
                    label="Молодец от"
                    value={draft.thresholdGoodCalls ?? 5}
                    onChange={v => updateDraft({ thresholdGoodCalls: v })}
                    min={1} max={99}
                    suffix="шт."
                  />
                  <NumberInput
                    label="Красавчик от"
                    value={draft.thresholdGreatCalls ?? 8}
                    onChange={v => updateDraft({ thresholdGreatCalls: v })}
                    min={1} max={99}
                    suffix="шт."
                  />
                </div>
              )}
              {draft.chatsEnabled && (
                <div className={draft.callsEnabled ? 'pt-4' : ''}>
                  <h3 className="text-body font-medium text-fg-muted mb-1">💬 Переписки</h3>
                  <NumberInput
                    label="Молодец от"
                    value={draft.thresholdGoodChats ?? 5}
                    onChange={v => updateDraft({ thresholdGoodChats: v })}
                    min={1} max={99}
                    suffix="шт."
                  />
                  <NumberInput
                    label="Красавчик от"
                    value={draft.thresholdGreatChats ?? 8}
                    onChange={v => updateDraft({ thresholdGreatChats: v })}
                    min={1} max={99}
                    suffix="шт."
                  />
                </div>
              )}
              {!draft.callsEnabled && !draft.chatsEnabled && (
                <p className="text-body text-fg-subtle py-2">Включите хотя бы один тип записей</p>
              )}
            </div>
          </Card>

          {/* === Качество текста === */}
          <Card padding="md">
            <h2 className="text-body-lg font-semibold text-fg mb-1">Качество самоанализа</h2>
            <p className="text-micro text-fg-subtle mb-4">
              50 символов ≈ 1 предложение &nbsp;•&nbsp; 150 символов ≈ 2–3 предложения
            </p>

            <div className="space-y-1 divide-y divide-border">
              <div className="pb-3">
                <h3 className="text-body font-medium text-fg-muted mb-2">Самоанализ менеджера</h3>
                <NumberInput
                  label='«Что сделано правильно»'
                  value={draft.minSelfReviewCorrectChars}
                  onChange={v => updateDraft({ minSelfReviewCorrectChars: v })}
                />
                <NumberInput
                  label='«Что можно улучшить»'
                  value={draft.minSelfReviewImproveChars}
                  onChange={v => updateDraft({ minSelfReviewImproveChars: v })}
                />
                <NumberInput
                  label='«Конкретные предложения»'
                  value={draft.minSelfReviewSuggestionsChars}
                  onChange={v => updateDraft({ minSelfReviewSuggestionsChars: v })}
                  hint="0 = поле необязательное"
                />
              </div>

              <div className="pt-3">
                <h3 className="text-body font-medium text-fg-muted mb-2">Ревью руководителя</h3>
                <NumberInput
                  label="Минимум символов в ревью"
                  value={draft.minReviewChars}
                  onChange={v => updateDraft({ minReviewChars: v })}
                />
              </div>
            </div>
          </Card>

          {/* === Нормативы РОПа === */}
          {canEdit && (
            <Card padding="md">
              <h2 className="text-body-lg font-semibold text-fg mb-1">Нормативы руководителя отдела продаж</h2>
              <p className="text-micro text-fg-subtle mb-4">
                По итогам диагностики: сколько ревью должен писать РОП в неделю, за сколько часов отвечать, какое качество ожидается.
                Ноль в «Ревью в неделю» → норматив не задан, статус светофора выключен.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <NumberInput
                  label="Минимум ревью в неделю"
                  value={draft.reviewNorms?.minReviewsPerWeek ?? 0}
                  onChange={v => updateDraft({ reviewNorms: { ...(draft.reviewNorms ?? DEFAULT_REVIEW_NORMS), minReviewsPerWeek: v } })}
                  min={0}
                  max={200}
                />
                <NumberInput
                  label="Максимум часов до ответа"
                  value={draft.reviewNorms?.maxHoursToRespond ?? DEFAULT_REVIEW_NORMS.maxHoursToRespond}
                  onChange={v => updateDraft({ reviewNorms: { ...(draft.reviewNorms ?? DEFAULT_REVIEW_NORMS), maxHoursToRespond: v } })}
                  min={1}
                  max={720}
                />
                <NumberInput
                  label="Средняя длина ревью, симв."
                  value={draft.reviewNorms?.minReviewCharsAvg ?? 150}
                  onChange={v => updateDraft({ reviewNorms: { ...(draft.reviewNorms ?? DEFAULT_REVIEW_NORMS), minReviewCharsAvg: v } })}
                  min={0}
                />
                <NumberInput
                  label="% качественных ревью"
                  value={draft.reviewNorms?.qualityThresholdPct ?? 80}
                  onChange={v => updateDraft({ reviewNorms: { ...(draft.reviewNorms ?? DEFAULT_REVIEW_NORMS), qualityThresholdPct: v } })}
                  min={0}
                  max={100}
                />
              </div>
            </Card>
          )}

          {/* === Премия РОПа за работу над ошибками === */}
          {canEdit && (
            <div
              id="section-rop-bonus"
              className={cn('scroll-mt-24 rounded-card transition-shadow duration-500', flashSection === 'rop-bonus' && 'ring-2 ring-accent-focus ring-offset-2')}
            >
              <RopBonusSettings
                value={draft.ropBonus}
                maxHoursToRespond={draft.reviewNorms?.maxHoursToRespond ?? DEFAULT_REVIEW_NORMS.maxHoursToRespond}
                onChange={v => updateDraft({ ropBonus: v })}
                ropNames={activeRopNames}
                savedEnabled={settings?.ropBonus?.enabled === true}
              />
            </div>
          )}

          {/* === Транскрипция звонков (superadmin управляет, owner видит расход) === */}
          {canEdit && (
            <TranscriptionSettingsCard
              companyId={companyId}
              value={settings?.transcription ?? null}
              isSuperadmin={isSuperadmin}
            />
          )}

          {/* === Доступ РОПа к шаблонам ревью === */}
          {canEdit && (
            <Card padding="md">
              <h2 className="text-body-lg font-semibold text-fg mb-1">Доступ РОПа к шаблонам ревью</h2>
              <p className="text-micro text-fg-subtle mb-4">
                По умолчанию РОП не видит шаблоны ревью. Включите, когда уверены, что РОП работает качественно и вы хотите, чтобы он использовал и редактировал шаблоны.
              </p>
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2">
                <div className="min-w-0 flex-1 basis-48">
                  <p className="text-body font-medium text-fg">Разрешить РОПу видеть и редактировать шаблоны</p>
                  <p className="text-micro text-fg-subtle mt-0.5">При выключенном режиме раздел «Шаблоны» у РОПа скрыт, в форме ревью dropdown «Шаблоны» не отображается.</p>
                </div>
                <Button
                  type="button"
                  onClick={() => updateDraft({ reviewerCanEditReviewTemplates: !(draft.reviewerCanEditReviewTemplates ?? false) })}
                  variant={draft.reviewerCanEditReviewTemplates ? 'primary' : 'secondary'}
                  size="sm"
                  role="switch"
                  aria-checked={draft.reviewerCanEditReviewTemplates}
                >
                  {draft.reviewerCanEditReviewTemplates ? 'Включено' : 'Выключено'}
                </Button>
              </div>
            </Card>
          )}

          {/* === Каналы еженедельной отчётности === */}
          {canEdit && (
            <Card
              id="section-report-channels"
              padding="md"
              className={cn('scroll-mt-24 transition-shadow duration-500', flashSection === 'report-channels' && 'ring-2 ring-accent-focus ring-offset-2')}
            >
              <h2 className="text-body-lg font-semibold text-fg mb-1">Каналы еженедельной отчётности</h2>
              <p className="text-micro text-fg-subtle mb-4">
                Каждый понедельник в 09:00 платформа отправит отчёт о работе над ошибками вашей команды.
                Email: подробный отчёт, Telegram: короткая сводка. Если поле пустое, канал не используется.
              </p>
              <div className="space-y-4">
                <div>
                  <label htmlFor={reportEmailsId} className="block text-body font-medium text-fg-muted mb-1">Email-адреса получателей</label>
                  <Input
                    id={reportEmailsId}
                    type="text"
                    value={(draft.reportChannels?.weeklyAccountability?.emails ?? []).join(', ')}
                    onChange={(e) => {
                      const list = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                      updateDraft({
                        reportChannels: {
                          weeklyAccountability: {
                            emails: list,
                            telegramChatIds: draft.reportChannels?.weeklyAccountability?.telegramChatIds ?? [],
                          },
                        },
                      });
                    }}
                    placeholder="owner@example.invalid, cto@example.invalid"
                  />
                  <p className="text-micro text-fg-subtle mt-1">Через запятую. Пусто = email не отправляется.</p>
                </div>
                <div>
                  <label htmlFor={reportTelegramId} className="block text-body font-medium text-fg-muted mb-1">Telegram получателей</label>
                  <Input
                    id={reportTelegramId}
                    type="text"
                    value={(draft.reportChannels?.weeklyAccountability?.telegramChatIds ?? []).join(', ')}
                    onChange={(e) => {
                      const list = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                      updateDraft({
                        reportChannels: {
                          weeklyAccountability: {
                            emails: draft.reportChannels?.weeklyAccountability?.emails ?? [],
                            telegramChatIds: list,
                          },
                        },
                      });
                    }}
                    placeholder="@ivanov, @petrov"
                  />
                  <p className="text-micro text-fg-subtle mt-1">
                    @username через запятую (например @ivanov, @petrov). Важно: каждый получатель должен один раз
                    написать боту платформы /start, иначе Telegram не разрешает боту писать первым. Пусто = Telegram не отправляется.
                  </p>
                  <div className="mt-2">
                    <TelegramLinkButton onLinked={() => window.location.reload()} />
                    <p className="text-micro text-fg-subtle mt-1">Проще: подключите свой Telegram в один клик, чат добавится в получатели автоматически.</p>
                  </div>
                </div>
              </div>
            </Card>
          )}

          {/* === Кнопка сохранения (norms tab) === */}
          {hasChanges && (
            <div className="sticky bottom-4 flex justify-end">
              <Button
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? 'Сохраняем…' : saved ? '✓ Сохранено' : 'Сохранить изменения'}
              </Button>
            </div>
          )}
        </>
      )}

      {draft && activeTab === 'sources' && (
        <>
          {/* === Источники === */}
          <Card padding="md">
            <h2 className="text-body-lg font-semibold text-fg mb-1">Источники</h2>
            <p className="text-micro text-fg-subtle mb-4">
              Эти варианты менеджер выбирает при загрузке записи: отмечает, откуда взят текст разговора.
              Оставьте те, которыми пользуется команда (Fireflies.ai и OTR.AI, сервисы расшифровки звонков)
            </p>
            <div className="divide-y divide-border">
              {draft.callsEnabled && (
                <SourceTagsEditor
                  label="📞 Источники звонков"
                  sources={draft.callSources ?? ['Fireflies.ai', 'OTR.AI', 'Вручную']}
                  onChange={v => updateDraft({ callSources: v })}
                />
              )}
              {draft.chatsEnabled && (
                <SourceTagsEditor
                  label="💬 Источники переписок"
                  sources={draft.chatSources ?? ['Instagram', 'Telegram', 'WhatsApp', 'VK', 'Другое']}
                  onChange={v => updateDraft({ chatSources: v })}
                />
              )}
            </div>
          </Card>

          {/* === Кнопка сохранения (sources tab) === */}
          {hasChanges && (
            <div className="sticky bottom-4 flex justify-end">
              <Button
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? 'Сохраняем…' : saved ? '✓ Сохранено' : 'Сохранить изменения'}
              </Button>
            </div>
          )}
        </>
      )}

      {/* === Шаблоны ревью === */}
      {activeTab === 'templates' && canEditTemplates && (
        <Card padding="md">
          <div className="flex flex-col items-stretch gap-3 mb-4 min-[480px]:flex-row min-[480px]:items-center min-[480px]:justify-between">
            <div>
              <h2 className="text-body-lg font-semibold text-fg">Шаблоны ревью</h2>
              <p className="text-micro text-fg-subtle mt-0.5">Заготовки текста для обратной связи менеджерам</p>
            </div>
            <Button
              type="button"
              onClick={() => { setShowCreateTemplate(true); setNewTemplateName(''); setNewTemplateContent(''); }}
              icon={<Plus />}
            >
              Создать шаблон
            </Button>
          </div>

          {/* Список шаблонов */}
          <div className="space-y-2">
            {reviewTemplates.length === 0 && (
              <p className="text-body text-fg-subtle py-2">Нет шаблонов. Создайте первый!</p>
            )}
            {reviewTemplates.map(tpl => (
              <div key={tpl.id} className="flex flex-col gap-3 min-[480px]:flex-row min-[480px]:items-start min-[480px]:justify-between p-3 rounded-block border border-border hover:border-border transition-colors">
                <div className="flex-1 min-w-0">
                  <p className="text-body font-medium text-fg">{tpl.name}</p>
                  <p className="text-micro text-fg-subtle mt-0.5">
                    v{tpl.version} · {tpl.createdByName ? `изменён ${tpl.createdByName}` : 'создан'}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 max-w-full">
                  <Button
                    type="button"
                    onClick={async () => {
                      setHistoryTemplate(tpl);
                      setLoadingHistory(true);
                      try {
                        const { data } = await reviewTemplatesApi.getHistory(companyId, tpl.id);
                        setTemplateHistory(data);
                      } catch {
                        setTemplateHistory([]);
                      } finally {
                        setLoadingHistory(false);
                      }
                    }}
                    variant="link"
                    size="sm"
                  >
                    История
                  </Button>
                  <Button
                    type="button"
                    onClick={() => {
                      setEditingTemplate(tpl);
                      setEditingTemplateName(tpl.name);
                      setEditingTemplateContent(tpl.content);
                    }}
                    variant="link"
                    size="sm"
                  >
                    Редактировать
                  </Button>
                  <Button
                    type="button"
                    onClick={async () => {
                      if (!window.confirm(`Удалить шаблон «${tpl.name}»? Шаблон пропадёт из списка и формы ревью; уже написанные ревью не изменятся.`)) return;
                      try {
                        await reviewTemplatesApi.deactivate(companyId, tpl.id);
                        setReviewTemplates(prev => prev.filter(t => t.id !== tpl.id));
                        toast.success('Шаблон удалён');
                      } catch {
                        toast.error('Не удалось удалить шаблон', { duration: Infinity });
                      }
                    }}
                    variant="ghost"
                    size="sm"
                    title="Удалить"
                    icon={<X />}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Форма создания шаблона */}
          {showCreateTemplate && (
            <div className="mt-4 p-4 border border-accent-muted rounded-block bg-accent-subtle space-y-3">
              <h3 className="text-body font-semibold text-fg">Новый шаблон</h3>
              <Input
                type="text"
                value={newTemplateName}
                onChange={e => setNewTemplateName(e.target.value)}
                placeholder="Название шаблона..."
              />
              <Textarea resize="none"
                value={newTemplateContent}
                onChange={e => setNewTemplateContent(e.target.value)}
                placeholder="Текст шаблона..."
                rows={5}
              />
              <div className="flex gap-2 justify-end">
                <Button
                  type="button"
                  onClick={() => setShowCreateTemplate(false)}
                  variant="ghost"
                  size="sm"
                >
                  Отмена
                </Button>
                <Button
                  type="button"
                  disabled={!newTemplateName.trim() || newTemplateContent.trim().length < 10}
                  onClick={async () => {
                    setSavingTemplate(true);
                    try {
                      const { data } = await reviewTemplatesApi.create(companyId, {
                        name: newTemplateName.trim(),
                        content: newTemplateContent.trim(),
                      });
                      setReviewTemplates(prev => [...prev, data]);
                      setShowCreateTemplate(false);
                      toast.success('Шаблон создан');
                    } catch {
                      toast.error('Не удалось создать шаблон', { duration: Infinity });
                    } finally {
                      setSavingTemplate(false);
                    }
                  }}
                  size="sm"
                >
                  {savingTemplate ? 'Сохраняем…' : 'Создать'}
                </Button>
              </div>
            </div>
          )}

          {/* Модал редактирования */}
          {editingTemplate && (
            <Modal
              size="md"
              open
              onClose={() => setEditingTemplate(null)}
              title="Редактировать шаблон"
              footer={(
                <>
                  <Button type="button" onClick={() => setEditingTemplate(null)} variant="ghost" size="md">Отмена</Button>
                  <Button
                    type="button"
                    disabled={!editingTemplateName.trim() || editingTemplateContent.trim().length < 10 || savingTemplate}
                    onClick={async () => {
                      setSavingTemplate(true);
                      try {
                        const { data } = await reviewTemplatesApi.update(companyId, editingTemplate.id, {
                          name: editingTemplateName.trim(),
                          content: editingTemplateContent.trim(),
                        });
                        setReviewTemplates(prev => prev.map(t => t.id === data.id ? data : t));
                        setEditingTemplate(null);
                        toast.success('Шаблон обновлён');
                      } catch {
                        toast.error('Не удалось сохранить', { duration: Infinity });
                      } finally {
                        setSavingTemplate(false);
                      }
                    }}
                    size="md"
                  >
                    {savingTemplate ? 'Сохраняем…' : 'Сохранить'}
                  </Button>
                </>
              )}
            >
              <div className="space-y-4">
                <Input
                  type="text"
                  value={editingTemplateName}
                  onChange={e => setEditingTemplateName(e.target.value)}
                />
                <Textarea resize="none"
                  value={editingTemplateContent}
                  onChange={e => setEditingTemplateContent(e.target.value)}
                  rows={8}
                />
              </div>
            </Modal>
          )}

          {/* Модал истории версий */}
          {historyTemplate && (
            <Modal
              size="md"
              open
              onClose={() => setHistoryTemplate(null)}
              title={`История: ${historyTemplate.name}`}
            >
              <div className="space-y-3">
                {loadingHistory && <p className="text-body text-fg-subtle animate-pulse">Загрузка...</p>}
                {!loadingHistory && templateHistory.length === 0 && (
                  <p className="text-body text-fg-subtle">История изменений пуста</p>
                )}
                {templateHistory.map(h => (
                  <div key={h.id} className="border border-border rounded-block p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-micro font-semibold text-accent-hover">v{h.version}</span>
                      <span className="text-micro text-fg-subtle">
                        {new Date(h.changedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
                        {' · '}{h.changedByName}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-micro">
                      <div>
                        <p className="text-fg-subtle mb-1">Было:</p>
                        <p className="text-fg-muted line-clamp-3 bg-canvas rounded-chip p-1.5">{h.previousContent.slice(0, 120)}…</p>
                      </div>
                      <div>
                        <p className="text-fg-subtle mb-1">Стало:</p>
                        <p className="text-fg-muted line-clamp-3 bg-success-subtle rounded-chip p-1.5">{h.newContent.slice(0, 120)}…</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Modal>
          )}
        </Card>
      )}

      {/* === Команда === */}
      {/* === Интеграции (CRM) === */}
      {activeTab === 'integrations' && canEdit && (
        <CrmIntegrationSettings
          companyId={companyId}
          transcriptionEnabled={Boolean(settings?.transcription?.enabled)}
          canImportTeam={isSuperadmin}
          onImported={({ created }) => {
            if (created.length) setImportedCreds(created);
            // Обновляем список «Команда» — импортированные сотрудники появляются сразу.
            companiesApi.getUsers(companyId).then(r => setTeamUsers(r.data)).catch(() => {});
          }}
        />
      )}

      {activeTab === 'team' && <Card padding="md">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-body-lg font-semibold text-fg">Команда</h2>
          {canEdit && (
            <Button
              onClick={() => setShowInviteModal(true)}
              size="sm"
              icon={<UserPlus />}
            >
              Пригласить
            </Button>
          )}
        </div>

        {/* Users list */}
        <div className="space-y-1 mb-6">
          {teamUsers.filter(u => u.role !== 'superadmin').map(u => (
            <div key={u.id}>
              <div className={cn('flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between py-2.5 px-3 rounded-block', !u.isActive && 'opacity-60')}>
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar name={u.fullName} color={u.color ?? undefined} size="md" />
                  <div className="min-w-0">
                    <p className="text-body font-medium text-fg truncate">{u.fullName}</p>
                    <p className="text-micro text-fg-subtle truncate">{u.email} · {ROLE_LABELS[u.role] ?? u.role}</p>
                  </div>
                </div>
                {/* Пока подтверждение открыто, колонка действий обязана сжиматься: иначе длинный
                    вопрос не переносится, уезжает за карточку и вытесняет имя того, про кого спрашивают
                    (замер на живом проде 16.09.2026: строка вылезала на 1280 и обрезалась). */}
                <div className={cn(
                  'flex items-center gap-x-2 gap-y-3 flex-wrap sm:flex-nowrap sm:ml-2 min-w-0',
                  (confirmRole === u.id || confirmDeactivate === u.id || confirmHardDelete === u.id)
                    ? 'w-full sm:w-auto'
                    : 'sm:flex-shrink-0',
                )}>
                  <Badge tone={USER_ACTIVITY_BADGE_COLOR[u.isActive ? 'active' : 'inactive']}>
                    {u.isActive ? 'Активен' : 'Неактивен'}
                  </Badge>
                  {isSuperadmin && u.isActive && (
                    <>
                      <Button
                        onClick={() => handleImpersonate(u.id)}
                        disabled={adminBusyId === u.id}
                        title="Открыть платформу так, как её видит этот сотрудник"
                        variant="secondary"
                        size="sm"
                        icon={<Eye />}
                      >
                        Глазами
                      </Button>
                      <Button
                        onClick={() => handleAdminResetPassword(u.id)}
                        disabled={adminBusyId === u.id}
                        title="Сбросить пароль и показать новый"
                        variant="secondary"
                        size="sm"
                        icon={<KeyRound />}
                      >
                        Пароль
                      </Button>
                    </>
                  )}
                  {resetResult?.userId === u.id && (
                    <span className="flex items-center gap-1.5 text-micro bg-warning-subtle border border-warning-border rounded-card px-2 py-1">
                      Новый пароль: <code className="font-mono font-semibold">{resetResult.password}</code>
                      <Button
                        onClick={() => { navigator.clipboard.writeText(resetResult.password); toast.success('Пароль скопирован'); }}
                        variant="link"
                        size="sm"
                      >
                        Копировать
                      </Button>
                      <Button onClick={() => setResetResult(null)} aria-label="Скрыть" variant="ghost" size="sm" icon={<X />} />
                    </span>
                  )}
                  {/* Deactivate/Activate + Delete — only for other users, not self */}
                  {u.id !== user?.id && (
                    confirmRole === u.id ? (
                      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:gap-1 w-full sm:w-auto min-w-0">
                        <span className="text-micro text-fg-subtle min-w-0 break-words">
                          {u.role === 'reviewer'
                            ? `${u.fullName} становится менеджером? Разбирать записи команды больше не сможет, начнёт сдавать свои. Написанные ревью сохранятся.`
                            + (teamUsers.filter(t => t.role === 'reviewer' && t.isActive && t.id !== u.id).length === 0
                                ? ' В компании не останется ни одного РОПа, и сданные записи будет некому разобрать.'
                                  + (bonusOn ? ' Премия РОПа при этом останется включённой, а считать её будет некому: выключите её в разделе «Нормативы» или назначьте нового РОПа.' : '')
                                : (bonusOn ? ' Премия РОПа считается по компании, поэтому перейдёт к тому, кто остаётся РОПом.' : ''))
                            : `${u.fullName} становится РОПом? Появится доступ к разбору записей всей команды, собственные записи сохранятся.`
                            + (bonusOn ? ` Премия РОПа включена, и со следующего расчёта она будет считаться для ${u.fullName}. Если премии у него не будет, выключите её в разделе «Нормативы».` : '')}
                        </span>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <Button onClick={() => handleChangeRole(u)} variant="primary" size="sm">{u.role === 'reviewer' ? 'Сделать менеджером' : 'Сделать РОПом'}</Button>
                          <Button onClick={() => setConfirmRole(null)} variant="ghost" size="sm">Отмена</Button>
                        </div>
                      </div>
                    ) : confirmDeactivate === u.id ? (
                      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:gap-1 w-full sm:w-auto min-w-0">
                        <span className="text-micro text-fg-subtle min-w-0 break-words">
                          {u.isActive
                            ? `Отключаем доступ: ${u.fullName}. Войти в платформу больше не сможет, записи сохранятся.`
                            : `Возвращаем доступ: ${u.fullName}?`}
                        </span>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <Button onClick={() => handleToggleActive(u)} variant="danger" size="sm">{u.isActive ? 'Деактивировать' : 'Активировать'}</Button>
                          <Button onClick={() => setConfirmDeactivate(null)} variant="ghost" size="sm">Отмена</Button>
                        </div>
                      </div>
                    ) : confirmHardDelete === u.id ? (
                      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:gap-1 w-full sm:w-auto min-w-0">
                        <span className="text-micro text-danger-fg min-w-0 break-words">
                          {`Удаляем навсегда: ${u.fullName}. Вместе с человеком удалятся его записи, самоанализы и ревью. Чтобы отключить доступ с сохранением истории, используйте деактивацию.`}
                        </span>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <Button onClick={() => handleHardDelete(u)} variant="danger" size="sm">Удалить навсегда</Button>
                          <Button onClick={() => setConfirmHardDelete(null)} variant="ghost" size="sm">Оставить</Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-0.5">
                        {(u.role === 'manager' || u.role === 'reviewer') && (
                          <Button
                            onClick={() => setConfirmRole(u.id)}
                            title={u.role === 'reviewer' ? 'Сделать менеджером' : 'Сделать РОПом'}
                            variant="ghost"
                            size="sm"
                            icon={<UserCog />}
                          />
                        )}
                        <Button
                          onClick={() => setConfirmDeactivate(u.id)}
                          title={u.isActive ? 'Деактивировать' : 'Активировать'}
                          variant="ghost"
                          size="sm"
                          icon={u.isActive ? <UserX /> : <UserCheck />}
                        />
                        <Button
                          onClick={() => setConfirmHardDelete(u.id)}
                          title="Удалить полностью (email освободится)"
                          variant="ghost"
                          size="sm"
                          icon={<Trash2 />}
                        />
                      </div>
                    )
                  )}
                </div>
              </div>
            </div>
          ))}
          {teamUsers.filter(u => u.role !== 'superadmin').length === 0 && (
            <p className="text-body text-fg-subtle py-2 px-3">Нет сотрудников</p>
          )}
        </div>

        {/* Pending invites */}
        {pendingInvites.length > 0 && (
          <div>
            <h3 className="text-body font-medium text-fg-muted mb-3">
              Ожидают принятия ({pendingInvites.length})
            </h3>
            <div className="space-y-2">
              {pendingInvites.map((invite) => {
                const link = `${window.location.origin}/invite/${invite.code}`;
                return (
                  <div key={invite.id} className="flex items-center justify-between bg-warning-subtle border border-warning-border rounded-card px-3 py-2">
                    <div>
                      <p className="text-body font-medium text-fg">{invite.email}</p>
                      <p className="text-micro text-fg-subtle">
                        {ROLE_LABELS[invite.role] ?? invite.role} · {new Date(invite.createdAt).toLocaleDateString('ru-RU')}
                        {invite.expiresAt && (
                          <span className="ml-1 text-fg-subtle">
                            · до {new Date(invite.expiresAt).toLocaleDateString('ru-RU')}
                          </span>
                        )}
                      </p>
                    </div>
                    <Button
                      onClick={() => handleCopyLink(link)}
                      variant="ghost"
                      size="sm"
                      title="Скопировать ссылку"
                      icon={<Copy />}
                    >
                      Копировать
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Card>}

      {/* === Безопасность === */}
      {/* Тот же личный контекст, что и «Мой профиль» выше — скрываем внутри карточки компании. */}
      {activeTab === 'profile' && !(isSuperadmin && companyId) && <Card padding="md">
        <h2 className="text-body-lg font-semibold text-fg mb-4">Безопасность</h2>
        <div className="space-y-3">
          <div className="py-2 border-b border-canvas">
            <ChangePasswordCard />
          </div>
          <div className="flex items-start gap-3 py-2">
            <div className="w-8 h-8 rounded-full bg-surface-sunken flex items-center justify-center flex-shrink-0 mt-0.5">
              <Mail className="w-4 h-4 text-fg-subtle" aria-hidden="true" />
            </div>
            <div>
              <p className="text-body font-medium text-fg">Email-уведомления</p>
              <p className="text-micro text-fg-subtle mt-0.5">
                Приглашения отправляются ссылкой: создайте её на вкладке «Команда» и отправьте сотруднику в мессенджере.
              </p>
            </div>
          </div>
        </div>
      </Card>}

      {/* === Invite Modal === */}
      {showInviteModal && (
        <Modal
          open
          onClose={handleCloseModal}
          title="Пригласить сотрудника"
          footer={(
            <>
              <Button
                onClick={handleCloseModal}
                variant="secondary"
                size="md"
              >
                Закрыть
              </Button>
              <Button
                onClick={handleSendInvite}
                disabled={sendingInvite || !inviteEmail.trim()}
                size="md"
              >
                {sendingInvite ? 'Создаём…' : 'Создать приглашение'}
              </Button>
            </>
          )}
        >
          <div className="space-y-4">
            <Notice tone="warning" title="Письмо не отправляется автоматически.">
              Скопируйте ссылку и отправьте сотруднику вручную через мессенджер или почту.
            </Notice>

            <fieldset className="space-y-4 border-0 p-0 m-0">
              <legend className="sr-only">Данные приглашаемого сотрудника</legend>
              {/* Full name */}
              <div>
                <label htmlFor={inviteNameId} className="text-body font-medium text-fg block mb-1">
                  Имя сотрудника
                </label>
                <Input
                  id={inviteNameId}
                  type="text"
                  placeholder="Иван Иванов"
                  value={inviteFullName}
                  onChange={(e) => setInviteFullName(e.target.value)}
                  autoFocus
                />
                <p className="text-micro text-fg-subtle mt-1">Сотрудник сможет изменить при регистрации</p>
              </div>

              {/* Email */}
              <div>
                <label htmlFor={inviteEmailId} className="text-body font-medium text-fg block mb-1">
                  Email сотрудника <span className="text-accent">*</span>
                </label>
                <Input
                  id={inviteEmailId}
                  type="email"
                  placeholder="email@company.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendInvite()}
                />
              </div>

              {/* Role */}
              <div>
                <label htmlFor={inviteRoleId} className="text-body font-medium text-fg block mb-1">
                  Роль
                </label>
                <Select
                  id={inviteRoleId}
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                >
                  <option value="manager">Менеджер</option>
                  <option value="reviewer">РОП</option>
                  <option value="owner">Владелец</option>
                </Select>
              </div>
            </fieldset>

            {/* Created invite link */}
            {createdInviteLink && (
              <div className="bg-success-subtle border border-success-border rounded-card p-3">
                <p className="flex items-center gap-1 text-micro font-medium text-success-fg mb-1">
                  <Check className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" /> Ссылка готова. Отправьте её сотруднику.
                </p>
                <div className="flex items-center gap-2 mt-2">
                  <p className="text-micro text-fg-subtle font-mono truncate flex-1">{createdInviteLink}</p>
                  <Button
                    onClick={() => handleCopyLink(createdInviteLink)}
                    variant="secondary"
                    size="sm"
                    icon={<Copy />}
                  >
                    Скопировать
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
