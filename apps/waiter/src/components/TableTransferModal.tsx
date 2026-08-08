'use client';

import React, { useState, useEffect } from 'react';
import { X, ArrowRightLeft, Search, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { useRouter } from 'next/navigation';

import ConfirmModal from './ConfirmModal';

interface TableTransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeOrder: any; 
  currentTableId: string;
}

export default function TableTransferModal({ isOpen, onClose, activeOrder, currentTableId }: TableTransferModalProps) {
  const router = useRouter();
  const toast = useToast();
  
  const [tables, setTables] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isTransferring, setIsTransferring] = useState(false);
  const [search, setSearch] = useState('');

  const [confirmTransfer, setConfirmTransfer] = useState<{ targetTable: any } | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadTables();
    }
  }, [isOpen]);

  const loadTables = async () => {
    setIsLoading(true);
    try {
      const data = await api.get('/tables');
      // Sadece bu masa haricindeki masaları getir
      setTables(data.filter((t: any) => t.id !== currentTableId));
    } catch (err: any) {
      toast.error('Masalar yüklenemedi');
    } finally {
      setIsLoading(false);
    }
  };

  const handleTransferInit = (targetTable: any) => {
     setConfirmTransfer({ targetTable });
  };

  const executeTransfer = async () => {
    if (!activeOrder || !confirmTransfer) return;
    const { targetTable } = confirmTransfer;

    setIsTransferring(true);
    try {
      await api.post(`/orders/${activeOrder.id}/transfer`, {
        newTableId: targetTable.id
      });
      
      toast.success(`Masa ${targetTable.number}'e başarıyla taşındı.`);
      onClose();
      // Taşıma bitince yeni masaya git!
      router.push(`/order/${targetTable.id}`);
    } catch (err: any) {
      toast.error(err.message || 'Masa taşınırken bir hata oluştu');
    } finally {
      setIsTransferring(false);
      setConfirmTransfer(null);
    }
  };

  if (!isOpen) return null;

  const filteredTables = tables.filter(t => t.number.toString().includes(search) || t.zone.toLowerCase().includes(search.toLowerCase()));

  return (
    <>
    <div className="modal-backdrop" onClick={onClose}>
      
      <div 
        className="drawer-content"
        style={{
          width: '100%', maxWidth: '440px',
          height: '85vh',
          display: 'flex', flexDirection: 'column',
          padding: '24px',
        }} 
        onClick={e => e.stopPropagation()}
      >
        
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ArrowRightLeft size={20} className="text-accent" />
              Masa Taşıma
            </h2>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
              Hesabı taşımak istediğiniz boş masayı seçin.
            </p>
          </div>
          <button onClick={onClose} style={{ 
            background: 'var(--bg-elevated)', border: 'none', width: 36, height: 36, 
            borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-secondary)'
          }}>
            <X size={20} />
          </button>
        </div>

        {/* Search */}
        <div style={{ position: 'relative', marginBottom: '20px' }}>
          <Search size={16} style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input 
            type="text" 
            placeholder="Masa no veya bölge ara..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: '100%', padding: '14px 16px 14px 44px', borderRadius: 'var(--radius-full)',
              border: '1.5px solid var(--border)', background: 'var(--bg-elevated)',
              fontSize: '0.9375rem', outline: 'none', color: 'var(--text-primary)',
              transition: 'all 0.2s'
            }}
          />
        </div>

        {/* Tables List */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', paddingBottom: '20px' }}>
          {isLoading ? (
            <div style={{ gridColumn: 'span 2', display: 'flex', justifyContent: 'center', padding: '40px' }}><Loader2 className="animate-spin text-accent" size={32} /></div>
          ) : filteredTables.length === 0 ? (
            <p style={{ gridColumn: 'span 2', textAlign: 'center', color: 'var(--text-muted)', marginTop: '40px' }}>Aradığınız kriterde masa bulunamadı.</p>
          ) : (
            filteredTables.map(t => (
              <button
                key={t.id}
                onClick={() => handleTransferInit(t)}
                disabled={isTransferring}
                style={{
                  display: 'flex', flexDirection: 'column', gap: '8px',
                  padding: '16px', borderRadius: 'var(--radius-lg)',
                  background: 'var(--bg-elevated)', 
                  border: `2px solid ${t.status === 'AVAILABLE' ? 'var(--border)' : 'var(--danger-border)'}`,
                  textAlign: 'left', cursor: 'pointer', transition: 'all 0.2s',
                  opacity: isTransferring ? 0.5 : 1,
                  position: 'relative'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h4 style={{ fontSize: '1.125rem', fontWeight: 900, color: 'var(--text-primary)' }}>{t.number}</h4>
                  <div style={{ 
                    width: '8px', height: '8px', borderRadius: '50%',
                    background: t.status === 'AVAILABLE' ? 'var(--success)' : 'var(--danger)'
                  }} />
                </div>
                <div style={{ fontSize: '0.6875rem', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.02em' }}>
                  {t.zone}
                </div>
              </button>
            ))
          )}
        </div>

      </div>
    </div>

    <ConfirmModal 
      isOpen={!!confirmTransfer}
      onClose={() => setConfirmTransfer(null)}
      onConfirm={executeTransfer}
      title="Masa Taşıma Onayı"
      description={`Mevcut adisyon Masa ${confirmTransfer?.targetTable?.number} üzerine taşınacaktır. Onaylıyor musunuz?`}
      type={confirmTransfer?.targetTable?.status !== 'AVAILABLE' ? 'warning' : 'info'}
      confirmText="Evet, Taşı"
    />
    </>
  );
}
