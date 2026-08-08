'use client';

// ==========================================
// Fiziksel Cikti Onizlemesi (BIREBIR)
// ==========================================
// Bu bilesen fisi KENDISI cizmez. print-agent ile birebir ayni
// @rest-otm/receipt-core motorunu cagirir ve donen satirlari ekrana basar.
// Bir satir burada nasil gorunuyorsa yazicidan da oyle cikar.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MAX_BOTTOM_MARGIN_MM,
  MAX_TOP_MARGIN_MM,
  buildReceiptDoc,
  padForAlign,
  type PrintLayoutKey,
  type ReceiptLayout,
} from '@rest-otm/receipt-core';

/** Termal yazici satir yuksekligi: 24 nokta = 3 mm (203 DPI). */
const LINE_MM = 3;
const FONT_PX = 12;
/** Monospace fontlarda karakter genisligi ~0.6em. */
const CH_PX = FONT_PX * 0.6;
/** 80 mm kagidin basilabilir alani ~72 mm, 58 mm kagidin ~48 mm. */
const PRINTABLE_MM: Record<58 | 80, number> = { 58: 48, 80: 72 };

type PreviewMode = 'NORMAL' | 'CANCEL' | 'TREAT';

interface ReceiptPreviewProps {
  type: PrintLayoutKey;
  layout: ReceiptLayout;
  onMarginChange?: (patch: { topMarginMm?: number; bottomMarginMm?: number }) => void;
}

function sampleInput(type: PrintLayoutKey, layout: ReceiptLayout, mode: PreviewMode) {
  const isStation = type === 'KITCHEN' || type === 'GRILL';
  const isTakeaway = type === 'PAKET';
  return {
    kind: (isStation ? 'STATION' : 'BILL') as 'STATION' | 'BILL',
    layout,
    orderNumber: 'TEST-001',
    tableNumber: isTakeaway ? 0 : 12,
    waiterName: 'Test Kullanıcısı',
    timestamp: new Date(2026, 6, 25, 11, 44),
    items: [
      { name: 'Adana Kebap', quantity: 2, price: 450, portionOption: 'Normal', notes: 'Az pişmiş' },
      { name: 'Ayran', quantity: 1, price: 60, portionOption: 'Normal' },
      { name: 'Künefe', quantity: 1, price: 180, portionOption: 'Normal', isPaid: true },
    ],
    total: 960,
    payments: isStation ? undefined : [{ method: 'CASH', amount: 500 }],
    paymentMethod: isTakeaway ? 'CASH' : null,
    customer: isTakeaway
      ? { name: 'Örnek Müşteri', phone: '0555 000 00 00', address: 'Örnek Mahallesi No: 12' }
      : null,
    notes: isTakeaway ? 'Kapıda kart ile ödeme' : null,
    isCancel: mode === 'CANCEL',
    isTreat: mode === 'TREAT',
  };
}

export default function ReceiptPreview({ type, layout, onMarginChange }: ReceiptPreviewProps) {
  const [mode, setMode] = useState<PreviewMode>('NORMAL');
  const dragRef = useRef<{ edge: 'top' | 'bottom'; startY: number; startMm: number } | null>(null);

  const doc = buildReceiptDoc(sampleInput(type, layout, mode));
  const paperWidth = layout.paperWidth === 58 ? 58 : 80;
  const paperPx = doc.columns * CH_PX;
  const pxPerMm = paperPx / PRINTABLE_MM[paperWidth];

  const handleMove = useCallback((event: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || !onMarginChange) return;
    const deltaMm = (event.clientY - drag.startY) / pxPerMm;
    const raw = drag.edge === 'top' ? drag.startMm + deltaMm : drag.startMm - deltaMm;
    const max = drag.edge === 'top' ? MAX_TOP_MARGIN_MM : MAX_BOTTOM_MARGIN_MM;
    const value = Math.round(Math.min(max, Math.max(0, raw)) * 2) / 2;
    onMarginChange(drag.edge === 'top' ? { topMarginMm: value } : { bottomMarginMm: value });
  }, [onMarginChange, pxPerMm]);

  const stopDrag = useCallback(() => { dragRef.current = null; }, []);

  useEffect(() => {
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', stopDrag);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', stopDrag);
    };
  }, [handleMove, stopDrag]);

  const startDrag = (edge: 'top' | 'bottom') => (event: React.PointerEvent) => {
    if (!onMarginChange) return;
    event.preventDefault();
    dragRef.current = {
      edge,
      startY: event.clientY,
      startMm: edge === 'top' ? layout.topMarginMm : layout.bottomMarginMm,
    };
  };

  const handleStyle = (edge: 'top' | 'bottom'): React.CSSProperties => ({
    position: 'absolute',
    left: 0,
    right: 0,
    [edge]: 0,
    height: 14,
    cursor: onMarginChange ? 'ns-resize' : 'default',
    background: 'repeating-linear-gradient(90deg,#38bdf8 0 6px,transparent 6px 12px)',
    opacity: 0.9,
    touchAction: 'none',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
      <div style={{ display: 'flex', gap: 6, alignSelf: 'stretch', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '0.7rem', fontWeight: 800, letterSpacing: 1, color: '#64748b' }}>
          FİZİKSEL ÇIKTI ÖNİZLEMESİ · {paperWidth} mm · {doc.columns} sütun
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['NORMAL', 'CANCEL', 'TREAT'] as PreviewMode[]).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              style={{
                fontSize: '0.7rem',
                padding: '4px 8px',
                borderRadius: 6,
                border: '1px solid #cbd5e1',
                background: mode === value ? '#0f172a' : 'transparent',
                color: mode === value ? '#fff' : '#334155',
                cursor: 'pointer',
              }}
            >
              {value === 'NORMAL' ? 'Normal' : value === 'CANCEL' ? 'İptal' : 'İkram'}
            </button>
          ))}
        </div>
      </div>

      <div
        style={{
          position: 'relative',
          width: paperPx,
          background: '#fff',
          color: '#000',
          boxShadow: '0 10px 30px rgba(15,23,42,0.18)',
          fontFamily: '"Roboto Mono","DejaVu Sans Mono",Menlo,Consolas,monospace',
          fontSize: FONT_PX,
          border: '1px solid #e2e8f0',
        }}
      >
        <div title={`Üst boşluk: ${layout.topMarginMm} mm`} style={handleStyle('top')} onPointerDown={startDrag('top')} />

        {/* Kagidin ustundeki gercek bosluk */}
        <div style={{ height: Math.max(0, doc.topMarginMm) * pxPerMm }} />

        {doc.logo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={doc.logo.url}
            alt="Fiş logosu"
            style={{
              display: 'block',
              width: doc.logo.widthMm * pxPerMm,
              marginLeft: doc.logo.align === 'right' ? 'auto' : doc.logo.align === 'center' ? 'auto' : 0,
              marginRight: doc.logo.align === 'left' ? 'auto' : doc.logo.align === 'center' ? 'auto' : 0,
            }}
            onError={(event) => { event.currentTarget.style.display = 'none'; }}
          />
        )}

        {doc.lines.map((line, index) => {
          const scaledColumns = Math.max(1, Math.floor(doc.columns / line.scale));
          return (
            <div
              key={`${index}-${line.source}`}
              style={{
                whiteSpace: 'pre',
                fontSize: FONT_PX * line.scale,
                lineHeight: `${LINE_MM * line.scale * pxPerMm}px`,
                fontWeight: line.bold ? 800 : 400,
                letterSpacing: 0,
              }}
            >
              {padForAlign(line.text, scaledColumns, line.align) || ' '}
            </div>
          );
        })}

        {/* Kesimden onceki gercek bosluk */}
        <div style={{ height: Math.max(0, doc.bottomMarginMm) * pxPerMm }} />
        <div style={{ borderTop: '2px dashed #94a3b8' }} />

        <div title={`Alt boşluk: ${layout.bottomMarginMm} mm`} style={handleStyle('bottom')} onPointerDown={startDrag('bottom')} />
      </div>

      <p style={{ fontSize: '0.7rem', color: '#64748b', textAlign: 'center', margin: 0 }}>
        Mavi şeritleri sürükleyerek üst ({layout.topMarginMm} mm) ve alt ({layout.bottomMarginMm} mm) boşluğu ayarla.
        Kesik çizgi kağıdın kesildiği yerdir.
      </p>
    </div>
  );
}
