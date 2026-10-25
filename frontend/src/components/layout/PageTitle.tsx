import { createContext, useContext, useEffect, type ReactNode } from 'react';

/**
 * Заголовок экрана один и стоит в шапке оболочки. Страница с динамическим заголовком
 * (имя компании, «Привет, Мария!») не рисует свой h1, а отдаёт текст сюда.
 */
export const PageTitleContext = createContext<(text: string | undefined) => void>(() => {});

export function PageTitle({ text }: { text: string | undefined }): ReactNode {
  const setTitle = useContext(PageTitleContext);
  useEffect(() => {
    setTitle(text);
    return () => setTitle(undefined);
  }, [text, setTitle]);
  return null;
}
