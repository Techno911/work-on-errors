import { useEffect } from 'react';
import { Toaster as SonnerToaster, toast } from 'sonner';

export { toast };

/** Одна точка монтирования уведомлений; AppShell уже содержит её. */
export function Toaster() {
  useEffect(() => {
    const markControls = () => {
      document.querySelectorAll<HTMLElement>('.chip-toast__action, .chip-toast__cancel')
        .forEach((element) => element.setAttribute('data-chip-control', ''));
    };
    markControls();
    const observer = new MutationObserver(markControls);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return (
    <SonnerToaster
      position="top-center"
      duration={3500}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: 'chip-toast',
          title: 'chip-toast__title',
          description: 'chip-toast__description',
          actionButton: 'chip-toast__action',
          cancelButton: 'chip-toast__cancel',
        },
      }}
    />
  );
}
