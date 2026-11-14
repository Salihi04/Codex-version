import { useCallback, useState } from 'react';

export interface ToastMessage {
  message: string;
  tone: 'success' | 'error';
}

export function useToast() {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const showToast = useCallback((message: string, tone: ToastMessage['tone']) => {
    setToast({ message, tone });
  }, []);
  const dismissToast = useCallback(() => setToast(null), []);
  return { toast, showToast, dismissToast };
}
