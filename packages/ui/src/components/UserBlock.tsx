import type { ReactNode } from 'react';
import { LogOut } from 'lucide-react';
import { Avatar } from './Avatar';
import type { VersionNumber } from '../version';

export interface UserAction {
  label: string;
  onClick: () => void;
  icon?: ReactNode;
}

export interface UserBlockProps {
  name: string;
  role: string;
  product: string;
  version: VersionNumber;
  avatarUrl?: string;
  collapsed?: boolean;
  actions?: readonly UserAction[];
  onLogout: () => void;
}

export function UserBlock({
  name,
  role,
  product,
  version,
  avatarUrl,
  collapsed = false,
  actions = [],
  onLogout,
}: UserBlockProps) {
  return (
    <div className="chip-user-block" data-collapsed={collapsed || undefined}>
      <div className="chip-user-block__identity">
        <Avatar name={name} src={avatarUrl} color={6} aria-hidden="true" />
        {collapsed ? null : (
          <div className="chip-user-block__copy">
            <div className="chip-user-block__name">{name}</div>
            <div className="chip-user-block__role">{role}</div>
          </div>
        )}
      </div>
      {collapsed || !actions.length ? null : (
        <div className="chip-user-block__actions">
          {actions.map((action) => (
            <button key={action.label} type="button" data-chip-control="" onClick={action.onClick}>
              {action.icon ? <span aria-hidden="true">{action.icon}</span> : null}
              {action.label}
            </button>
          ))}
        </div>
      )}
      <button type="button" data-chip-control="" className="chip-user-block__logout" onClick={onLogout} aria-label="Выйти" title="Выйти">
        <LogOut aria-hidden="true" />
        {collapsed ? null : <span>Выйти</span>}
      </button>
      {collapsed ? null : (
        <div className="chip-user-block__version" data-chip-version="">{product}, v{version}</div>
      )}
    </div>
  );
}
