'use client';

import React, { useState, useEffect, useRef } from 'react';
import { X, Delete, Lock } from 'lucide-react';
import { api } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';

interface PinPadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (user: any) => void;
  title?: string;
  description?: string;
  requiredRole?: string[];
}

export default function PinPadModal({
  isOpen,
  onClose,
  onSuccess,
  title = 'PIN Doğrulama',
  description = 'Kritik işlem için yetkili PIN kodu giriniz.',
  requiredRole,
}: PinPadModalProps) {
  const toast = useToast();
  const [pin, setPin] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  // Prevent double-fire from useEffect + manual submit
  const verifyingRef = useRef(false);

  useEffect(() => {
    if (isOpen) {
      setPin('');
      setErrorMsg('');
      verifyingRef.current = false;
    }
  }, [isOpen]);

  const handleKeyPress = (num: string) => {
    if (pin.length < 6) {
      setErrorMsg('');
      setPin((prev) => prev + num);
    }
  };

  const handleBackspace = () => {
    setPin((prev) => prev.slice(0, -1));
    setErrorMsg('');
  };

  const handleVerify = async (currentPin: string) => {
    if (currentPin.length < 4 || verifyingRef.current) return;

    verifyingRef.current = true;
    setIsVerifying(true);
    setErrorMsg('');

    try {
      const response = await api.post('/auth/verify-pin', { pin: currentPin });

      if (requiredRole && !requiredRole.includes(response.role)) {
        setErrorMsg('Bu işlem için yetkiniz bulunmuyor.');
        setPin('');
        verifyingRef.current = false;
        return;
      }

      // Success — call callback, do NOT close (parent will decide)
      onSuccess(response);
    } catch (err: any) {
      // Show error in modal — do NOT close, do NOT logout
      const msg =
        err?.response?.data?.message ||
        err?.message ||
        'Geçersiz PIN kodu. Lütfen tekrar deneyin.';
      setErrorMsg(msg);
      setPin('');
      verifyingRef.current = false;
    } finally {
      setIsVerifying(false);
    }
  };

  // Auto-verify when 4 digits entered
  useEffect(() => {
    if (pin.length === 4) {
      const timer = setTimeout(() => handleVerify(pin), 250);
      return () => clearTimeout(timer);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-content"
        style={{
          width: '100%',
          maxWidth: '340px',
          padding: '32px 24px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ marginBottom: '24px', textAlign: 'center', width: '100%' }}>
          <div
            style={{
              width: '64px',
              height: '64px',
              borderRadius: '50%',
              background: 'var(--bg-elevated)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
              color: 'var(--accent)',
            }}
          >
            <Lock size={28} />
          </div>
          <h2
            style={{
              fontSize: '1.25rem',
              fontWeight: 800,
              color: 'var(--text-primary)',
              lineHeight: 1.2,
            }}
          >
            {title}
          </h2>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '8px' }}>
            {description}
          </p>
        </div>

        {/* PIN dots */}
        <div style={{ display: 'flex', gap: '12px', marginBottom: errorMsg ? 12 : '32px' }}>
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              style={{
                width: '14px',
                height: '14px',
                borderRadius: '50%',
                background:
                  pin.length > i
                    ? isVerifying
                      ? 'var(--accent)'
                      : errorMsg
                      ? 'var(--danger)'
                      : 'var(--accent)'
                    : 'var(--border-strong)',
                transition: 'all 0.15s ease',
                transform: pin.length === i + 1 ? 'scale(1.2)' : 'scale(1)',
                boxShadow: pin.length > i ? '0 0 8px var(--accent)' : 'none',
              }}
            />
          ))}
        </div>

        {/* Error message — stays in modal */}
        {errorMsg && (
          <div
            style={{
              width: '100%',
              padding: '10px 16px',
              marginBottom: 20,
              background: 'var(--danger-light)',
              color: 'var(--danger)',
              borderRadius: 'var(--radius-md)',
              fontWeight: 700,
              fontSize: '0.875rem',
              textAlign: 'center',
              border: '1px solid var(--danger-border, #fca5a5)',
            }}
          >
            {errorMsg}
          </div>
        )}

        {/* Numpad */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '12px',
            width: '100%',
          }}
        >
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((num) => (
            <button
              key={num}
              onClick={() => handleKeyPress(num)}
              disabled={isVerifying}
              style={{
                height: '68px',
                borderRadius: 'var(--radius-lg)',
                border: 'none',
                background: 'var(--bg-elevated)',
                color: 'var(--text-primary)',
                fontSize: '1.5rem',
                fontWeight: 700,
                cursor: isVerifying ? 'not-allowed' : 'pointer',
                transition: 'all 0.1s',
                opacity: isVerifying ? 0.6 : 1,
              }}
              onMouseDown={(e) => (e.currentTarget.style.transform = 'scale(0.92)')}
              onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
            >
              {num}
            </button>
          ))}
          <div />
          <button
            onClick={() => handleKeyPress('0')}
            disabled={isVerifying}
            style={{
              height: '68px',
              borderRadius: 'var(--radius-lg)',
              border: 'none',
              background: 'var(--bg-elevated)',
              color: 'var(--text-primary)',
              fontSize: '1.5rem',
              fontWeight: 700,
              cursor: isVerifying ? 'not-allowed' : 'pointer',
              opacity: isVerifying ? 0.6 : 1,
            }}
            onMouseDown={(e) => (e.currentTarget.style.transform = 'scale(0.92)')}
            onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
          >
            0
          </button>
          <button
            onClick={handleBackspace}
            disabled={isVerifying}
            style={{
              height: '68px',
              borderRadius: 'var(--radius-lg)',
              border: 'none',
              background: 'transparent',
              color: 'var(--text-secondary)',
              fontSize: '1.5rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: isVerifying ? 'not-allowed' : 'pointer',
            }}
          >
            <Delete size={24} />
          </button>
        </div>

        <button
          onClick={onClose}
          style={{
            marginTop: '32px',
            background: 'none',
            border: 'none',
            color: 'var(--text-muted)',
            fontSize: '0.9375rem',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Vazgeç
        </button>
      </div>
    </div>
  );
}
