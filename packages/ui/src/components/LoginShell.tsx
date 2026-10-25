import type { ReactNode } from 'react';
import { BrandLogo } from './Brand';
import type { VersionNumber } from '../version';

export interface LoginPromiseInset {
  overline: string;
  text: string;
  note: string;
  illustration?: ReactNode;
}

export interface LoginPromise {
  title: string;
  description: string;
  items: readonly [string, string, string];
  inset?: LoginPromiseInset;
}

export interface LoginShellProps {
  product: string;
  company?: string;
  promise: LoginPromise;
  form: ReactNode;
  overline: ReactNode;
  footer: ReactNode;
  version?: VersionNumber;
}

function PromiseSlot({ value }: { value: LoginPromise }) {
  return (
    <div className="chip-login__promise-copy">
      <h2>{value.title}</h2>
      <p>{value.description}</p>
      {value.inset ? (
        <section className="chip-login__inset">
          <div className="chip-login__inset-overline">{value.inset.overline}</div>
          <div className="chip-login__inset-body">
            {value.inset.illustration ? (
              <div className="chip-login__inset-illustration" aria-hidden="true">
                {value.inset.illustration}
              </div>
            ) : null}
            <div className="chip-login__inset-copy">
              <p>{value.inset.text}</p>
              <p>{value.inset.note}</p>
            </div>
          </div>
        </section>
      ) : null}
      <ol>
        {value.items.map((item, index) => (
          <li key={index}>
            <span>{String(index + 1).padStart(2, '0')}</span>
            <div>{item}</div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function LoginShell({
  product,
  company = 'Чирков и партнёры',
  promise,
  form,
  overline,
  footer,
  version,
}: LoginShellProps) {
  return (
    <div className="chip-login-shell">
      <aside className="chip-login__panel">
        <div className="chip-login__panel-content">
          <BrandLogo product={product} subtitle={company} tone="light" />
          <div className="chip-login__promise">
            <PromiseSlot value={promise} />
          </div>
          <footer className="chip-login__footer">{footer}</footer>
        </div>
      </aside>
      <main className="chip-login__stage">
        <div className="chip-login__form-column">
          <div className="chip-login__mobile-brand">
            <BrandLogo product={product} subtitle={company} tone="dark" />
          </div>
          <div className="chip-login__overline">{overline}</div>
          {form}
          {version ? <div className="chip-login__version" data-chip-version="">{product}, v{version}</div> : null}
        </div>
      </main>
    </div>
  );
}
