'use client';

import React, { useState, useEffect } from 'react';
import { X, Plus, Minus, MessageSquare, Utensils } from 'lucide-react';
import Portal from './ui/Portal';

interface OrderItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  menuItem: any | null;
  onAdd: (item: any) => void;
}

export default function OrderItemModal({ isOpen, onClose, menuItem, onAdd }: OrderItemModalProps) {
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState('');
  const [selectedPortion, setSelectedPortion] = useState<{ name: string; multiplier: number }>({ name: 'Normal', multiplier: 1.0 });

  // Body scroll lock
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => { document.body.style.overflow = 'unset'; };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && menuItem) {
      setQty(1);
      setNotes('');
      // parse portion options if they exist
      let portions = [{ name: 'Normal', multiplier: 1.0 }];
      try {
        if (typeof menuItem.portionOptions === 'string') {
          const parsed = JSON.parse(menuItem.portionOptions);
          if (Array.isArray(parsed) && parsed.length > 0) portions = parsed;
        } else if (Array.isArray(menuItem.portionOptions) && menuItem.portionOptions.length > 0) {
          portions = menuItem.portionOptions;
        }
      } catch (e) {}
      
      setSelectedPortion(portions[0] || { name: 'Normal', multiplier: 1.0 });
    }
  }, [isOpen, menuItem]);

  if (!isOpen || !menuItem) return null;

  const basePrice = menuItem.basePrice || 0;
  const unitPrice = basePrice * selectedPortion.multiplier;
  const totalPrice = unitPrice * qty;

  let portionsList: any[] = [{ name: 'Normal', multiplier: 1.0 }];
  try {
    if (typeof menuItem.portionOptions === 'string') {
      const parsed = JSON.parse(menuItem.portionOptions);
      if (Array.isArray(parsed) && parsed.length > 0) portionsList = parsed;
    } else if (Array.isArray(menuItem.portionOptions) && menuItem.portionOptions.length > 0) {
      portionsList = menuItem.portionOptions;
    }
  } catch (e) {}

  const handleAdd = () => {
    onAdd({
      menuItemId: menuItem.id,
      name: menuItem.name,
      price: unitPrice,
      qty,
      portionOption: selectedPortion.name,
      portionMultiplier: selectedPortion.multiplier,
      notes: notes.trim(),
      cartItemId: `${menuItem.id}-${Date.now()}`
    });
    onClose();
  };

  return (
    <Portal>
      <div className="modal-overlay" onClick={onClose}>
        
        <div 
          className="modal-box"
          style={{ maxWidth: '480px' }} 
          onClick={e => e.stopPropagation()}
        >
          
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
            <div>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 900, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>{menuItem.name}</h2>
              <p style={{ fontSize: '0.9375rem', color: 'var(--accent)', fontWeight: 700, marginTop: '4px' }}>
                ₺{basePrice.toLocaleString('tr-TR')}
              </p>
            </div>
            <button onClick={onClose} style={{ 
              background: 'var(--bg-elevated)', border: 'none', width: 40, height: 40, 
              borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--text-secondary)', cursor: 'pointer'
            }}>
              <X size={22} />
            </button>
          </div>

          <div className="modal-content-scroll" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {/* Portions */}
            {portionsList.length > 1 && (
              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                  <Utensils size={14} /> PORSIYON SEÇİMİ
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  {portionsList.map((p: any, i: number) => (
                    <button
                      key={i}
                      onClick={() => setSelectedPortion(p)}
                      style={{
                        padding: '14px',
                        borderRadius: 'var(--radius-lg)',
                        border: `2px solid ${selectedPortion.name === p.name ? 'var(--accent)' : 'var(--border)'}`,
                        background: selectedPortion.name === p.name ? 'var(--accent-muted)' : 'var(--bg-elevated)',
                        color: selectedPortion.name === p.name ? 'var(--accent)' : 'var(--text-primary)',
                        fontWeight: 700, fontSize: '1rem',
                        textAlign: 'center',
                        transition: 'all 0.2s',
                        display: 'flex', flexDirection: 'column', gap: '2px'
                      }}
                    >
                      {p.name}
                      <span style={{ fontSize: '0.75rem', opacity: 0.7, fontWeight: 600 }}>₺{(basePrice * p.multiplier).toLocaleString('tr-TR')}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Quantity */}
            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 16, display: 'block' }}>
                MİKTAR
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '20px', background: 'var(--bg-elevated)', padding: '6px', borderRadius: 'var(--radius-full)', width: 'fit-content' }}>
                <button 
                  className="qty-btn"
                  onClick={() => setQty(Math.max(1, qty - 1))}
                  style={{ width: 48, height: 48, borderRadius: '50%' }}
                >
                  <Minus size={20} />
                </button>
                <span style={{ fontSize: '1.5rem', fontWeight: 900, width: 44, textAlign: 'center', color: 'var(--text-primary)' }}>{qty}</span>
                <button 
                  className="qty-btn"
                  onClick={() => setQty(qty + 1)}
                  style={{ width: 48, height: 48, borderRadius: '50%' }}
                >
                  <Plus size={20} />
                </button>
              </div>
            </div>

            {/* Notes */}
            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <MessageSquare size={14} /> SİPARİŞ NOTU
              </label>
              <textarea 
                className="input"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Örn: Az pişmiş, soğansız..."
                style={{ height: 100, resize: 'none', padding: '16px' }}
              />
            </div>
          </div>

          {/* Footer Actions */}
          <button
            className="btn btn-primary"
            onClick={handleAdd}
            style={{
              width: '100%', height: 60, borderRadius: 'var(--radius-lg)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 28px',
              marginTop: '16px', flexShrink: 0
            }}
          >
            <span style={{ fontSize: '1.125rem' }}>Sepete Ekle</span>
            <span style={{ fontSize: '1.25rem', fontWeight: 900 }}>₺{totalPrice.toLocaleString('tr-TR')}</span>
          </button>

        </div>
      </div>
    </Portal>
  );
}

