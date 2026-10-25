import { useState, useCallback, useRef } from 'react';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export function useSaveIndicator() {
  const [status, setStatus] = useState<SaveStatus>('idle');
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startSaving = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setStatus('saving');
  }, []);

  const saved = useCallback(() => {
    setStatus('saved');
    timeoutRef.current = setTimeout(() => setStatus('idle'), 2000);
  }, []);

  const error = useCallback(() => {
    setStatus('error');
    timeoutRef.current = setTimeout(() => setStatus('idle'), 3000);
  }, []);

  return { status, startSaving, saved, error };
}
