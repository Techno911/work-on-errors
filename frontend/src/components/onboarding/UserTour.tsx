import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, ChevronLeft, Hand, Phone, PenLine, Bell, BarChart3, Settings2, Mail, Users, Wallet, TrendingUp, BookOpen, type LucideIcon } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { Button, Modal } from '@chirkov/shell';
import { usersApi } from '@/api/users';

interface Step {
  emoji: string; // ключ иконки
  title: string;
  body: string;
  cta?: string;
}

const STEPS_MANAGER: Step[] = [
  {
    emoji: '👋',
    title: 'Добро пожаловать в «Работу над ошибками»',
    body: 'Каждую неделю вы будете загружать звонки и переписки, которые не привели к продаже, разбирать их и получать обратную связь от РОПа, руководителя отдела продаж. Это занимает 15–20 минут на запись.',
  },
  {
    emoji: '📞',
    title: 'Добавьте запись',
    body: 'Откройте раздел «Доска спринта» в боковом меню. Нажмите «Добавить звонок» или «Добавить переписку». Для звонка загрузите аудио или вставьте транскрипцию, для переписки вставьте скриншоты (Ctrl+V) либо текст диалога.',
  },
  {
    emoji: '✍️',
    title: 'Напишите самоанализ',
    body: 'Заполните три поля: что сделано хорошо, что улучшить, какие выводы. Пишите конкретно. Это ваш собственный разбор. РОП увидит его и напишет ревью.',
  },
  {
    emoji: '📖',
    title: 'Методичка и аттестация',
    body: 'Со временем в разделе «Методичка» появятся правила «как делаем у нас», которые РОП собрал на ваших же разборах. Раздел «Аттестация» проверит, как вы их усвоили: задача придёт на главную, когда РОП назначит тест.',
  },
  {
    emoji: '🔔',
    title: 'Дождитесь ревью',
    body: 'Когда РОП напишет ревью, вы получите уведомление в колокольчике. Прочитайте его и попробуйте применить рекомендацию на следующей неделе.',
    cta: 'Загрузить первую запись',
  },
];

const STEPS_REVIEWER: Step[] = [
  {
    emoji: '👋',
    title: 'Добро пожаловать в «Работу над ошибками»',
    body: 'Ваша роль: РОП на платформе. Будете читать самоанализ менеджеров и писать им экспертные ревью. Через 4 недели из тегов сложатся паттерны: увидим, на чём команда срывается чаще всего.',
  },
  {
    emoji: '📊',
    title: 'Ваши показатели',
    body: 'На дашборде есть карточка «Ваши показатели за неделю»: количество ревью, медиана времени ответа, % качества. Светофор показывает, выполняете ли вы норматив.',
  },
  {
    emoji: '✏️',
    title: 'Как писать ревью',
    body: 'Откройте запись со статусом «Ждёт ревью». Заполните одно поле «Ревью» по структуре: что сделано не так и почему это важно, как это повлияло на результат продажи, что попробовать в следующий раз. Выберите теги ошибок: это ядро аналитики.',
  },
  {
    emoji: '📖',
    title: 'Методичка и аттестация',
    body: 'Раздел «Методичка» собирает правила «как делаем у нас» прямо из ваших разборов: платформа сама замечает повторяющиеся ошибки и предлагает карточку, вы подтверждаете. Когда карточек наберётся достаточно, в разделе «Аттестация» можно проверить команду, вопросы платформа тоже напишет сама.',
  },
  {
    emoji: '📈',
    title: 'Аналитика: через 4 недели',
    body: 'Не торопитесь смотреть аналитику в первую неделю: данных мало. Через месяц в разделе «Аналитика» увидите тренды по ошибкам и прогресс команды.',
    cta: 'К доске спринта',
  },
];

// Мастера настройки больше нет: пространство настроил трекер, владелец попадает сразу сюда.
// Поэтому тур ничего не просит настраивать — показывает, что уже работает и где смотреть результат.
const STEPS_OWNER: Step[] = [
  {
    emoji: '👋',
    title: 'Всё готово, добро пожаловать',
    body: 'Пространство уже настроено, команда заведена. Платформа делает работу над ошибками прозрачной: каждую неделю вы получаете сводку, кто разбирает звонки и переписки, кто растёт, где повторяются ошибки.',
  },
  {
    emoji: '📊',
    title: 'Где смотреть результат',
    body: 'На главной странице виден прогресс команды за неделю и свежие разборы. Раздел «Аналитика» через пару недель покажет, на чём команда срывается чаще всего, и как это меняется со временем.',
  },
  {
    emoji: '📨',
    title: 'Первый отчёт уже в пути',
    body: 'Первый отчёт придёт в ближайший понедельник в 09:00 на канал, который настроил трекер. Если на главной странице висит оранжевое предупреждение, что отчёты не подключены, нажмите в нём «Подключить Telegram»: это один клик. Получателей и каналы можно поменять в настройках в любой момент.',
    cta: 'Отлично, начать',
  },
];

// Шаг про премию — добавляется в тур РОПа, только если премия включена в компании.
// Суммы и пороги подставляются из настроек компании, не зашиты в текст.
function buildRopBonusStep(tiers: { thresholdPct: number; amount: number }[]): Step {
  const sorted = [...tiers].sort((a, b) => a.thresholdPct - b.thresholdPct);
  const max = sorted.length > 0 ? Math.max(...sorted.map(t => t.amount)) : 0;
  const tierText = sorted.map(t => `от ${t.thresholdPct}% ревью в срок: ${t.amount.toLocaleString('ru-RU')} ₽`).join(', ');
  return {
    emoji: '💰',
    title: 'Ваша премия',
    body: sorted.length > 0
      ? `Пишите ревью в срок и получайте премию до ${max.toLocaleString('ru-RU')} ₽ в месяц: ${tierText}. Текущий процент и прогноз смотрите в карточке на главной странице.`
      : 'На главной есть карточка «Премия за работу над ошибками»: платформа сама считает процент ревью в срок за месяц и показывает сумму к выплате.',
  };
}

interface Props {
  onClose: () => void;
  // Предпросмотр тура конкретной роли из «Инструкции» (независимо от роли пользователя).
  role?: 'manager' | 'reviewer' | 'owner';
  // Режим предпросмотра: не отмечаем онбординг пройденным и не уводим со страницы.
  preview?: boolean;
  ropBonusEnabled?: boolean;
  ropBonusTiers?: { thresholdPct: number; amount: number }[];
}

export function UserTour({ onClose, role, preview = false, ropBonusEnabled = false, ropBonusTiers = [] }: Props) {
  const user = useAuthStore(s => s.user);
  const setUser = useAuthStore(s => s.setUser);
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [closing, setClosing] = useState(false);

  // Роль тура: явно переданная (предпросмотр из инструкции) либо собственная роль пользователя.
  const effectiveRole = role ?? user?.role;
  const steps =
    effectiveRole === 'manager' ? STEPS_MANAGER :
    effectiveRole === 'reviewer'
      ? (ropBonusEnabled
          ? [...STEPS_REVIEWER.slice(0, -1), buildRopBonusStep(ropBonusTiers), STEPS_REVIEWER[STEPS_REVIEWER.length - 1]]
          : STEPS_REVIEWER)
      : STEPS_OWNER;

  // Клэмп шага, если массив шагов сократился, пока тур уже открыт (например, ropBonusEnabled
  // переключился с включённого на выключенный на «премиальном» шаге РОПа) — иначе steps[step]
  // уйдёт в undefined и модалка упадёт с рантайм-ошибкой вместо того чтобы просто закрыться.
  useEffect(() => {
    setStep(s => Math.min(s, steps.length - 1));
  }, [steps.length]);

  const current = steps[Math.min(step, steps.length - 1)];
  const isLast = Math.min(step, steps.length - 1) === steps.length - 1;

  const handleClose = async () => {
    if (closing) return;
    setClosing(true);
    // Предпросмотр из инструкции не отмечает онбординг пройденным (это чужая/повторная роль).
    if (!preview) {
      try {
        const { data } = await usersApi.markOnboardingSeen();
        setUser(data);
      } catch {
        // Не блокируем UX из-за ошибки сохранения
      }
    }
    onClose();
  };

  const handleFinish = async () => {
    await handleClose();
    // Предпросмотр — остаёмся на инструкции, никуда не уводим.
    if (preview) return;
    // Финал тура ведёт к действию: менеджер — сразу к форме первой записи,
    // РОП — к доске (там путь к ожидающим), владелец — в настройки
    if (user?.role === 'owner' || user?.role === 'superadmin') {
      navigate('/settings');
    } else if (user?.role === 'manager') {
      navigate('/sprint?action=add&type=call');
    } else {
      navigate('/sprint');
    }
  };

  return (
    <Modal
      open
      onClose={handleClose}
      closeOnBackdrop={false}
      title={current.title}
      footer={
        <>
          <Button
            type="button"
            onClick={() => setStep(s => Math.max(0, s - 1))}
            disabled={step === 0}
            variant="ghost"
            size="sm"
            icon={<ChevronLeft />}
          >
            Назад
          </Button>

          {isLast ? (
            <Button type="button" onClick={handleFinish}>
              {/* В предпросмотре кнопка не уводит со страницы — подпись нейтральная, без ложного CTA */}
              {preview ? 'Закрыть' : (current.cta ?? 'Начать')}
            </Button>
          ) : (
            <Button type="button" onClick={() => setStep(s => s + 1)} iconRight={<ChevronRight />}>
              Далее
</Button>
          )}
        </>
      }
    >
      <span className="block text-micro text-fg-subtle font-mono mb-2">{Math.min(step, steps.length - 1) + 1} / {steps.length}</span>

      <div className="flex gap-1 mb-4">
        {steps.map((_, i) => (
          <div
            key={i}
            className={`flex-1 h-1 rounded-full transition-all ${i <= step ? 'bg-accent' : 'bg-border'}`}
          />
        ))}
      </div>

      <div className="w-16 h-16 mb-3 rounded-full flex items-center justify-center bg-accent-subtle">
        {(() => {
          const ICONS: Record<string, LucideIcon> = {
            '👋': Hand, '📞': Phone, '✍️': PenLine, '🔔': Bell, '📊': BarChart3,
            '✏️': PenLine, '📈': TrendingUp, '⚙️': Settings2, '📨': Mail, '👥': Users, '💰': Wallet,
            '📖': BookOpen,
          };
          const Icon = ICONS[current.emoji] ?? Hand;
          return <Icon className="w-8 h-8 text-accent" />;
        })()}
      </div>
      <p className="text-body text-fg-muted">{current.body}</p>
    </Modal>
  );
}
