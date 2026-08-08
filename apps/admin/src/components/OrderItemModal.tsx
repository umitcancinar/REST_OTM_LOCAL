'use client';

import React, { useState, useEffect } from 'react';
import { X, Plus, Minus, MessageSquare, Utensils, Hash } from 'lucide-react';
import styles from './OrderItemModal.module.css';

interface OrderItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  menuItem: any | null;
  onAdd: (item: any) => void;
}

const MAX_QUICK_QTY = 20;

export default function OrderItemModal({ isOpen, onClose, menuItem, onAdd }: OrderItemModalProps) {
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState('');
  const [selectedPortion, setSelectedPortion] = useState<{ name: string; multiplier: number }>({
    name: 'Normal',
    multiplier: 1.0,
  });

  useEffect(() => {
    if (isOpen && menuItem) {
      setQty(1);
      setNotes('');
      let portions = [{ name: 'Normal', multiplier: 1.0 }];
      try {
        if (typeof menuItem.portionOptions === 'string') {
          const parsed = JSON.parse(menuItem.portionOptions);
          if (Array.isArray(parsed) && parsed.length > 0) portions = parsed;
        } else if (Array.isArray(menuItem.portionOptions) && menuItem.portionOptions.length > 0) {
          portions = menuItem.portionOptions;
        }
      } catch {}
      setSelectedPortion(portions[0] || { name: 'Normal', multiplier: 1.0 });
    }
  }, [isOpen, menuItem]);

  if (!isOpen || !menuItem) return null;

  const basePrice = menuItem.basePrice || 0;
  const unitPrice = basePrice * selectedPortion.multiplier;
  const effectiveQty = qty;
  const totalPrice = unitPrice * effectiveQty;

  let portionsList: any[] = [{ name: 'Normal', multiplier: 1.0 }];
  try {
    if (typeof menuItem.portionOptions === 'string') {
      const parsed = JSON.parse(menuItem.portionOptions);
      if (Array.isArray(parsed) && parsed.length > 0) portionsList = parsed;
    } else if (Array.isArray(menuItem.portionOptions) && menuItem.portionOptions.length > 0) {
      portionsList = menuItem.portionOptions;
    }
  } catch {}

  const handleAdd = () => {
    onAdd({
      menuItemId: menuItem.id,
      name: menuItem.name,
      price: unitPrice,
      qty: effectiveQty,
      portionOption: selectedPortion.name,
      portionMultiplier: selectedPortion.multiplier,
      notes: notes.trim(),
      cartItemId: `${menuItem.id}-${Date.now()}`,
    });
    onClose();
  };

  const decrementQty = () => setQty((prev) => {
    if (prev <= 0.25) return 0.25;
    if (prev <= 1) return prev - 0.25;
    if (prev <= 2) return prev - 0.5;
    return prev - 1;
  });

  const incrementQty = () => setQty((prev) => {
    if (prev < 1) return prev + 0.25;
    if (prev < 2) return prev + 0.5;
    return Math.min(MAX_QUICK_QTY, prev + 1);
  });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.titleGroup}>
            <h2 className={styles.title}>{menuItem.name}</h2>
            <p className={styles.basePrice}>₺{basePrice.toLocaleString('tr-TR')}</p>
          </div>
          <button onClick={onClose} className={styles.closeBtn}>
            <X size={24} />
          </button>
        </div>

        {/* Portions */}
        {portionsList.length > 1 && (
          <div>
            <label className={styles.label}>
              <Utensils size={16} /> PORSIYON SEÇİMİ
            </label>
            <div className={styles.portionsGrid}>
              {portionsList.map((p: any, i: number) => (
                <button
                  key={i}
                  onClick={() => setSelectedPortion(p)}
                  className={`${styles.portionBtn} ${
                    selectedPortion.name === p.name ? styles.portionBtnActive : ''
                  }`}
                >
                  {p.name}
                  <span className={styles.portionPrice}>
                    ₺{(basePrice * p.multiplier).toLocaleString('tr-TR')}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Quantity section */}
        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 14,
            }}
          >
            <label className={styles.label} style={{ margin: 0 }}>
              <Hash size={16} /> MİKTAR
            </label>
          </div>
          
            <div className={styles.quantityControl}>
              <button
                className="qty-btn"
                onClick={decrementQty}
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: '50%',
                  border: 'none',
                  background: 'var(--bg-surface)',
                  boxShadow: 'var(--shadow-sm)',
                }}
              >
                <Minus size={22} />
              </button>
              <span className={styles.qtyVal}>{qty}</span>
              <button
                className="qty-btn"
                onClick={incrementQty}
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: '50%',
                  border: 'none',
                  background: 'var(--bg-surface)',
                  boxShadow: 'var(--shadow-sm)',
                }}
              >
                <Plus size={22} />
              </button>
            </div>
        </div>

        {/* Notes */}
        <div>
          <label className={styles.label}>
            <MessageSquare size={16} /> SİPARİŞ NOTU
          </label>
          <textarea
            className={styles.notesInput}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Örn: Az pişmiş, soğansız..."
          />
        </div>

        {/* Footer */}
        <button className={styles.footerBtn} onClick={handleAdd}>
          <span className={styles.footerBtnText}>
            {qty} Adet Ekle
          </span>
          <span className={styles.footerBtnPrice}>₺{totalPrice.toLocaleString('tr-TR')}</span>
        </button>
      </div>
    </div>
  );
}
