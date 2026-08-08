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
  success: { accent: 'var(--success)', icon: CheckCircle2 },
  error: { accent: 'var(--danger)', icon: XCircle },
  info: { accent: 'var(--accent)', icon: Info },
  warning: { accent: 'var(--warning)', icon: AlertTriangle },
};

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: (id: string) => void }) {
  const [exiting, setExiting] = useState(false);
  const { accent, icon: Icon } = COLORS[toast.type];

  const handleRemove = useCallback(() => {
    setExiting(true);
    setTimeout(() => onRemove(toast.id), 300);
  }, [toast.id, onRemove]);

  useEffect(() => {
    const timer = setTimeout(handleRemove, toast.duration ?? 3500);
    return () => clearTimeout(timer);
  }, [toast.duration, handleRemove]);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '16px 20px',
        background: 'var(--bg-glass)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '1.5px solid var(--border-strong)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-lg)',
        minWidth: 280,
        maxWidth: '90vw',
        position: 'relative',
        overflow: 'hidden',
        animation: exiting
          ? 'toastOut 0.3s cubic-bezier(0.4,0,0.2,1) forwards'
          : 'toastIn 0.4s cubic-bezier(0.34,1.56,0.64,1) forwards',
      }}
    >
      <div style={{
         position: 'absolute', left: 0, top: 0, bottom: 0, width: '4px',
         background: accent
      }} />
      
      <div style={{
         display: 'flex', alignItems: 'center', justifyContent: 'center',
         width: '32px', height: '32px', borderRadius: '50%', background: `${accent}15`, color: accent
      }}>
        <Icon size={18} strokeWidth={2.5} />
      </div>

      <span style={{ flex: 1, fontSize: '0.9375rem', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.4 }}>
        {toast.message}
      </span>
      
      <button
        onClick={handleRemove}
        style={{
          background: 'none', border: 'none', cursor: 'pointer', padding: 4,
          color: 'var(--text-muted)', display: 'flex', alignItems: 'center',
        }}
      >
        <X size={16} />
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
          bottom: '100px', // Above bottom nav
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 'var(--z-toast)',
          display: 'flex',
          flexDirection: 'column-reverse',
          gap: 12,
          alignItems: 'center',
          pointerEvents: 'none',
          width: '100%'
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
          from { opacity: 0; transform: translateY(40px) scale(0.9); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes toastOut {
          from { opacity: 1; transform: scale(1); }
          to   { opacity: 0; transform: scale(0.9); }
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
