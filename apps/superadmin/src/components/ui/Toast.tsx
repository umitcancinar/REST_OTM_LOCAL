'use client';

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { CheckCircle2, XCircle, Info, AlertTriangle, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

interface ToastContextType {
  toast: {
    success: (msg: string, duration?: number) => void;
    error: (msg: string, duration?: number) => void;
    info: (msg: string, duration?: number) => void;
    warning: (msg: string, duration?: number) => void;
  };
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

const ICONS = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
  warning: AlertTriangle,
};

const COLORS = {
  success: { bg: 'var(--toast-success-bg)', color: 'var(--toast-success-color)', border: 'var(--toast-success-border)' },
  error: { bg: 'var(--toast-error-bg)', color: 'var(--toast-error-color)', border: 'var(--toast-error-border)' },
  info: { bg: 'var(--toast-info-bg)', color: 'var(--toast-info-color)', border: 'var(--toast-info-border)' },
  warning: { bg: 'var(--toast-warning-bg)', color: 'var(--toast-warning-color)', border: 'var(--toast-warning-border)' },
};

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: (id: string) => void }) {
  const [exiting, setExiting] = useState(false);
  const Icon = ICONS[toast.type];
  const colors = COLORS[toast.type];

  const handleRemove = useCallback(() => {
    setExiting(true);
    setTimeout(() => onRemove(toast.id), 300);
  }, [toast.id, onRemove]);

  useEffect(() => {
    const timer = setTimeout(handleRemove, toast.duration ?? 4000);
    return () => clearTimeout(timer);
  }, [toast.duration, handleRemove]);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '14px 16px',
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        borderRadius: 14,
        boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
        minWidth: 280,
        maxWidth: 400,
        backdropFilter: 'blur(12px)',
        animation: exiting
          ? 'toastOut 0.3s cubic-bezier(0.4,0,0.2,1) forwards'
          : 'toastIn 0.35s cubic-bezier(0.34,1.56,0.64,1) forwards',
        cursor: 'default',
        userSelect: 'none',
      }}
    >
      <Icon size={20} color={colors.color} strokeWidth={2.5} style={{ flexShrink: 0 }} />
      <span style={{ flex: 1, fontSize: '0.875rem', fontWeight: 500, color: colors.color, lineHeight: 1.4 }}>
        {toast.message}
      </span>
      <button
        onClick={handleRemove}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 4,
          borderRadius: 6,
          color: colors.color,
          opacity: 0.6,
          display: 'flex',
          alignItems: 'center',
          transition: 'opacity 0.15s',
        }}
        onMouseOver={e => (e.currentTarget.style.opacity = '1')}
        onMouseOut={e => (e.currentTarget.style.opacity = '0.6')}
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((type: ToastType, message: string, duration?: number) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts(prev => [...prev, { id, type, message, duration }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const toast = {
    success: (msg: string, duration?: number) => addToast('success', msg, duration),
    error: (msg: string, duration?: number) => addToast('error', msg, duration),
    info: (msg: string, duration?: number) => addToast('info', msg, duration),
    warning: (msg: string, duration?: number) => addToast('warning', msg, duration),
  };

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        style={{
          position: 'fixed',
          top: 20,
          right: 20,
          zIndex: 99999,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          alignItems: 'flex-end',
          pointerEvents: 'none',
        }}
      >
        {toasts.map(t => (
          <div key={t.id} style={{ pointerEvents: 'auto' }}>
            <ToastItem toast={t} onRemove={removeToast} />
          </div>
        ))}
      </div>
      <style>{`
        @keyframes toastIn {
          from { opacity: 0; transform: translateX(24px) scale(0.95); }
          to   { opacity: 1; transform: translateX(0) scale(1); }
        }
        @keyframes toastOut {
          from { opacity: 1; transform: translateX(0) scale(1); }
          to   { opacity: 0; transform: translateX(24px) scale(0.95); }
        }
      `}</style>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx.toast;
}
