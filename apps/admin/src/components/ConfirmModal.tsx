'use client';

import React from 'react';
import { AlertCircle, HelpCircle, AlertTriangle, CheckCircle2, X } from 'lucide-react';

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  type?: 'info' | 'warning' | 'danger' | 'success';
  confirmText?: string;
  cancelText?: string;
}

const ICONS = {
  info: HelpCircle,
  warning: AlertTriangle,
  danger: AlertCircle,
  success: CheckCircle2
};

const COLORS = {
  info: 'var(--accent)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  success: 'var(--success)'
};

export default function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  type = 'info',
  confirmText = 'Tamam',
  cancelText = 'Vazgeç'
}: ConfirmModalProps) {
  if (!isOpen) return null;

  const Icon = ICONS[type];
  const color = COLORS[type];

  return (
    <div className="modal-backdrop" style={{ zIndex: 'calc(var(--z-modal-backdrop) + 100)' }} onClick={onClose}>
      <div 
        className="modal-content"
        style={{ 
          zIndex: 'calc(var(--z-modal-content) + 100)',
          width: '100%', maxWidth: '380px', padding: '32px 24px',
          display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center',
          position: 'relative'
        }} 
        onClick={e => e.stopPropagation()}
      >
        {/* Close Button */}
        <button 
          onClick={onClose}
          style={{
            position: 'absolute', top: '16px', right: '16px',
            background: 'var(--bg-elevated)', border: 'none',
            width: '32px', height: '32px', borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: 'var(--text-secondary)'
          }}
        >
          <X size={18} />
        </button>
        
        <div style={{ 
          width: '64px', height: '64px', borderRadius: '50%', 
          background: `${color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: '20px', color: color
        }}>
          <Icon size={32} />
        </div>

        <h2 style={{ fontSize: '1.25rem', fontWeight: 900, color: 'var(--text-primary)', letterSpacing: '-0.02em', marginBottom: '8px' }}>
          {title}
        </h2>
        <p style={{ fontSize: '0.9375rem', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: '32px' }}>
          {description}
        </p>

        <div style={{ display: 'flex', gap: '12px', width: '100%' }}>
          <button
            onClick={onClose}
            className="waiter-btn waiter-btn-ghost"
            style={{ flex: 1, height: '56px', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-lg)' }}
          >
            {cancelText}
          </button>
          <button
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className="waiter-btn"
            style={{ 
              flex: 1, height: '56px', 
              background: type === 'danger' ? 'var(--gradient-danger)' : type === 'warning' ? 'var(--warning)' : 'var(--gradient-accent)',
              color: 'white', borderRadius: 'var(--radius-lg)',
              boxShadow: 'var(--shadow-md)'
            }}
          >
            {confirmText}
          </button>
        </div>

      </div>
    </div>
  );
}
