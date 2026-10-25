import { Inbox, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Button, Input, Badge, Card, EmptyState } from '@chirkov/shell';
import { Label } from '@/components/ui/input';
import { PageTitle } from '@/components/layout/PageTitle';

/**
 * Витрина для замера внутренних экранов без бэкенда и без входа (демо-учётки
 * сознательно без хранимого пароля — «Дизайн-система платформ» решение
 * 30.07.2026). Собирается только при VITE_DS_STAND=1 (ds/стенд.sh), маршрут
 * /ds-stand внутри реальных AppLayout+Sidebar — те же роли пакета, что и на
 * боевых страницах, без похода за реальными данными.
 */
export function DsStandPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <PageTitle text="Витрина оболочки" />
        <p className="text-body text-fg-subtle mt-1">
          Реальные компоненты платформы на демонстрационных данных: замер
          токенов пакета без входа и без бэкенда.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card padding="md" elevation="raised">
          <p className="text-micro font-semibold text-fg-subtle uppercase tracking-overline">Разборов за неделю</p>
          <p className="text-page font-semibold text-fg mt-2">24</p>
          <p className="text-body text-success-fg mt-1">+6 к прошлой неделе</p>
        </Card>
        <Card padding="md" elevation="raised">
          <p className="text-micro font-semibold text-fg-subtle uppercase tracking-overline">Ждут ревью</p>
          <p className="text-page font-semibold text-fg mt-2">3</p>
          <p className="text-body text-warning-fg mt-1">Норматив 24 часа</p>
        </Card>
        <Card padding="md" elevation="raised">
          <p className="text-micro font-semibold text-fg-subtle uppercase tracking-overline">Просрочено</p>
          <p className="text-page font-semibold text-fg mt-2">1</p>
          <p className="text-body text-danger-fg mt-1">Требует внимания</p>
        </Card>
      </div>

      <Card padding="md" elevation="raised" className="space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="text-title font-semibold text-fg">Черновик правила</h2>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge tone="success"><CheckCircle2 className="w-3 h-3" />Принято</Badge>
            <Badge tone="warning"><AlertTriangle className="w-3 h-3" />На проверке</Badge>
            <Badge tone="danger">Ошибка</Badge>
          </div>
        </div>
        <p className="text-body text-fg-muted">
          Менеджер не называет сроки следующего шага: клиент сам решает, когда
          вернуться к разговору.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="primary">Принять правило</Button>
          <Button type="button" variant="secondary">Обсудить</Button>
          <Button type="button" variant="secondary">Отклонить</Button>
          <Button type="button" variant="ghost">Отложить</Button>
        </div>
      </Card>

      <Card padding="md" elevation="raised" className="space-y-4">
        <h2 className="text-title font-semibold text-fg">Настройки уведомлений</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-xl">
          <div>
            <Label htmlFor="stand-email">Email</Label>
            <Input id="stand-email" value="rop@example.invalid" readOnly />
          </div>
          <div>
            <Label htmlFor="stand-name">Имя</Label>
            <Input id="stand-name" value="Демо Пользователь" readOnly />
          </div>
        </div>
      </Card>

      <Card padding="md" elevation="raised">
        <EmptyState
          icon={Inbox}
          title="Очередь пуста"
          description="Новые записи появятся здесь после разбора звонков за неделю."
          action={<Button type="button" variant="secondary">Перейти к текущей неделе</Button>}
        />
      </Card>
    </div>
  );
}
