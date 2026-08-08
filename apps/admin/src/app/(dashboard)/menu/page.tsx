'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { api } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { 
  Plus, Search, Edit2, Trash2, Eye, EyeOff, Save, X, GripVertical, Image as ImageIcon,
  UtensilsCrossed, ArrowDownUp, ChevronLeft, ChevronRight
} from 'lucide-react';
import styles from './page.module.css';

// DnD Kit Imports
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';

function suggestedDepartment(categoryName: string): string {
  const normalized = categoryName
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i');

  if (/\b(izgara|mangal|ocakbasi)/.test(normalized)) return 'GRILL';
  if (/\b(icecek|mesrubat|bar)/.test(normalized)) return 'BAR';
  return 'KITCHEN';
}

// --- Sortable Item Component ---
function SortableItem({ item, onEdit, onDelete, onStatusToggle }: any) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 100 : 'auto',
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className={styles.itemCard}>
      <div {...attributes} {...listeners} className={styles.dragHandle}>
        <GripVertical size={20} />
      </div>
      
      <div className={styles.thumbWrapper}>
        {item.image ? <img src={item.image} alt={item.name} /> : <ImageIcon size={24} />}
      </div>

      <div className={styles.itemInfo}>
        <div className={styles.itemName}>
          {item.name}
          {item.badge && <span className={styles.badge}>{item.badge}</span>}
        </div>
        <div className={styles.itemMeta}>
          <span className={styles.itemPrice}>₺{item.basePrice?.toLocaleString('tr-TR')}</span>
          {item.calories && <span>• 🔥 {item.calories} kcal</span>}
          {item.preparationTime && <span>• ⏱️ {item.preparationTime} dk</span>}
          {!item.isActive && <span style={{color: 'var(--accent-danger)'}}>• Satışa Kapalı</span>}
        </div>
      </div>

      <div className={styles.itemActions}>
        <button 
          className={styles.iconBtn} 
          onClick={(e) => { e.stopPropagation(); onStatusToggle(item); }}
          title={item.isActive ? 'Satışa Kapat' : 'Satışa Aç'}
        >
          {item.isActive ? <Eye size={16} /> : <EyeOff size={16} />}
        </button>
        <button 
          className={`${styles.iconBtn} ${styles.editBtn}`} 
          onClick={(e) => { e.stopPropagation(); onEdit(item); }}
          title="Düzenle"
        >
          <Edit2 size={16} />
        </button>
        <button 
          className={`${styles.iconBtn} ${styles.deleteBtn}`} 
          onClick={(e) => { e.stopPropagation(); onDelete(item.id); }}
          title="Sil"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
}

// --- Sortable Category Component ---
function SortableCategoryItem({ cat }: any) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: cat.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 100 : 'auto',
    opacity: isDragging ? 0.6 : 1,
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px 16px',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    marginBottom: '8px'
  };

  return (
    <div ref={setNodeRef} style={style}>
      <div {...attributes} {...listeners} style={{ cursor: 'grab', color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center' }}>
        <GripVertical size={20} />
      </div>
      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
        {cat.name}
      </div>
    </div>
  );
}

// --- Main Page Component ---
export default function MenuPage() {
  const [categories, setCategories] = useState<any[]>([]);
  const [menuItems, setMenuItems] = useState<any[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingSort, setIsSavingSort] = useState(false);
  
  const catTabsRef = useRef<HTMLDivElement>(null);
  
  const scrollCategories = (direction: 'left' | 'right') => {
    if (catTabsRef.current) {
      const scrollAmount = 300;
      catTabsRef.current.scrollBy({ left: direction === 'left' ? -scrollAmount : scrollAmount, behavior: 'smooth' });
    }
  };
  
  // Drawer State
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  // Category Drawer State
  const [isCatDrawerOpen, setIsCatDrawerOpen] = useState(false);
  const [isCatSortModalOpen, setIsCatSortModalOpen] = useState(false);
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [catName, setCatName] = useState('');

  const toast = useToast();

  const [formData, setFormData] = useState({
    name: '',
    categoryId: '',
    basePrice: '',
    image: '',
    description: '',
    extraInfo: '',
    badge: '',
    preparationTime: '',
    department: 'KITCHEN',
    taxRate: '20',
    calories: '',
    allergens: '',
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  async function loadData() {
    try {
      const [cats, items] = await Promise.all([
        api.get('/menu/categories?includeInactive=true'),
        api.get('/menu/items?includeInactive=true')
      ]);
      setCategories(cats);
      setMenuItems(items);
      if (cats.length > 0 && !activeCategory) setActiveCategory(cats[0].id);
    } catch (err) {
      toast.error('Menü verileri yüklenemedi.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { loadData(); }, []);

  const filteredItems = useMemo(() => 
    menuItems.filter(item => item.categoryId === activeCategory)
  , [menuItems, activeCategory]);

  const handleOpenDrawer = (item?: any) => {
    if (item) {
      setEditingId(item.id);
      setFormData({
        name: item.name,
        categoryId: item.categoryId,
        basePrice: item.basePrice.toString(),
        image: item.image || '',
        description: item.description || '',
        extraInfo: item.extraInfo || '',
        badge: item.badge || '',
        preparationTime: item.preparationTime?.toString() || '',
        department: item.department || 'KITCHEN',
        taxRate: item.taxRate?.toString() || '20',
        calories: item.calories?.toString() || '',
        allergens: Array.isArray(item.allergens) ? item.allergens.join(', ') : '',
      });
    } else {
      const activeCategoryName = categories.find((category) => category.id === activeCategory)?.name || '';
      setEditingId(null);
      setFormData({
        name: '',
        categoryId: activeCategory,
        basePrice: '',
        image: '',
        description: '',
        extraInfo: '',
        badge: '',
        preparationTime: '',
        department: suggestedDepartment(activeCategoryName),
        taxRate: '20',
        calories: '',
        allergens: '',
      });
    }
    setIsDrawerOpen(true);
  };

  const handleCloseDrawer = () => {
    setIsDrawerOpen(false);
    setTimeout(() => {
      setEditingId(null);
    }, 300);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      ...formData,
      basePrice: Number(formData.basePrice),
      preparationTime: Number(formData.preparationTime) || undefined,
      calories: formData.calories ? Number(formData.calories) : undefined,
      allergens: formData.allergens
        ? formData.allergens.split(',').map((a) => a.trim()).filter(Boolean)
        : [],
      categoryId: formData.categoryId || activeCategory,
      taxRate: Number(formData.taxRate) || 0
    };

    try {
      if (editingId) {
        await api.patch(`/menu/items/${editingId}`, payload);
        toast.success('Ürün güncellendi');
      } else {
        await api.post('/menu/items', payload);
        toast.success('Yeni ürün eklendi');
      }
      handleCloseDrawer();
      loadData();
    } catch (err: any) {
      toast.error(err.message || 'Hata oluştu');
    }
  };

  const handleSaveCategory = async () => {
    if (!catName.trim()) return toast.error('Kategori adı zorunludur');
    try {
      if (editingCatId) {
        await api.patch(`/menu/categories/${editingCatId}`, { name: catName });
        toast.success('Kategori güncellendi');
      } else {
        await api.post('/menu/categories', { name: catName });
        toast.success('Yeni kategori eklendi');
      }
      setIsCatDrawerOpen(false);
      loadData();
    } catch (err: any) {
      toast.error(err.message || 'Hata oluştu');
    }
  };

  const handleToggleCategory = async (cat: any, e: any) => {
    e.stopPropagation();
    try {
      await api.patch(`/menu/categories/${cat.id}`, { isActive: !cat.isActive });
      toast.success(`${cat.name} durumu güncellendi.`);
      loadData();
    } catch (err) {
      toast.error('Durum güncellenemedi');
    }
  };

  const openCategoryDrawer = (cat?: any) => {
    if (cat) {
      setEditingCatId(cat.id);
      setCatName(cat.name);
    } else {
      setEditingCatId(null);
      setCatName('');
    }
    setIsCatDrawerOpen(true);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setMenuItems((items) => {
        const oldIndex = items.findIndex((i) => i.id === active.id);
        const newIndex = items.findIndex((i) => i.id === over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  const handleCategoryDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setCategories((cats) => {
        const oldIndex = cats.findIndex((c) => c.id === active.id);
        const newIndex = cats.findIndex((c) => c.id === over.id);
        return arrayMove(cats, oldIndex, newIndex);
      });
    }
  };

  const saveCategorySortOrder = async () => {
    setIsSavingSort(true);
    try {
      const orderedIds = categories.map((cat) => cat.id);
      await api.patch('/menu/categories/reorder', { orderedIds });
      toast.success('Kategori sıralaması kaydedildi!');
      setIsCatSortModalOpen(false);
      loadData();
    } catch (err) {
      toast.error('Kategori sıralaması kaydedilemedi.');
    } finally {
      setIsSavingSort(false);
    }
  };

  const saveSortOrder = async () => {
    setIsSavingSort(true);
    try {
      const updates = filteredItems.map((item, index) => ({
        id: item.id,
        sortOrder: index
      }));
      await Promise.all(updates.map(u => api.patch(`/menu/items/${u.id}`, { sortOrder: u.sortOrder })));
      toast.success('Sıralama değişiklikleri kaydedildi!');
    } catch (err) {
      toast.error('Sıralama kaydedilemedi.');
    } finally {
      setIsSavingSort(false);
    }
  };

  if (isLoading) return <div className="animate-pulse" style={{ padding: 32, color: 'var(--text-tertiary)' }}>Yükleniyor...</div>;

  return (
    <div className={`animate-fade-in ${styles.container}`}>
      {/* ─── HEADER ────────────────────────────────────── */}
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Menü Yönetimi</h1>
          <p className={styles.pageSubtitle}>Kategorilerinizdeki ürünleri düzenleyin ve yönetin.</p>
        </div>
        <div className={styles.headerActions}>
          <button 
            className={`${styles.btn} ${styles.btnSecondary}`} 
            onClick={saveSortOrder}
            disabled={isSavingSort}
          >
            <ArrowDownUp size={16} /> 
            {isSavingSort ? 'Kaydediliyor...' : 'Sıralamayı Kaydet'}
          </button>
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => handleOpenDrawer()}>
            <Plus size={18} /> Yeni Ürün Ekle
          </button>
        </div>
      </div>

      {/* ─── CATEGORIES TABS ───────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px' }}>
        <button 
          onClick={() => scrollCategories('left')}
          style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'var(--bg-surface)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-secondary)', flexShrink: 0 }}
        >
          <ChevronLeft size={20} />
        </button>
        <div className={styles.catTabsWrapper} ref={catTabsRef} style={{ flex: 1, marginBottom: 0 }}>
          {categories.map(cat => (
            <button 
              key={cat.id} 
              className={`${styles.catTab} ${activeCategory === cat.id ? styles.catTabActive : ''}`}
              onClick={() => setActiveCategory(cat.id)}
              style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: cat.isActive ? 1 : 0.6 }}
            >
              <span>{cat.name}</span>
              <div style={{ display: 'flex', gap: '4px', opacity: activeCategory === cat.id ? 1 : 0.3 }}>
                <Edit2 
                  size={14} 
                  onClick={(e) => { e.stopPropagation(); openCategoryDrawer(cat); }} 
                  style={{ cursor: 'pointer' }}
                />
                {cat.isActive ? (
                  <Eye size={14} onClick={(e) => handleToggleCategory(cat, e)} style={{ cursor: 'pointer' }} />
                ) : (
                  <EyeOff size={14} onClick={(e) => handleToggleCategory(cat, e)} style={{ cursor: 'pointer' }} />
                )}
              </div>
            </button>
          ))}
          <button 
            className={styles.catTab} 
            onClick={() => openCategoryDrawer()}
            style={{ borderStyle: 'dashed', borderColor: 'var(--border)', display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            <Plus size={16} /> Yeni Ekle
          </button>
          <button 
            className={styles.catTab} 
            onClick={() => setIsCatSortModalOpen(true)}
            style={{ borderStyle: 'dashed', borderColor: 'var(--border)', display: 'flex', alignItems: 'center', gap: '4px', background: 'var(--bg-muted)' }}
          >
            <ArrowDownUp size={16} /> Sırala
          </button>
        </div>
        <button 
          onClick={() => scrollCategories('right')}
          style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'var(--bg-surface)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-secondary)', flexShrink: 0 }}
        >
          <ChevronRight size={20} />
        </button>
      </div>

      {/* ─── LIST COLUMN ─────────────────────────────── */}
      <div className={styles.listContainer}>
        <DndContext 
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          modifiers={[restrictToVerticalAxis]}
        >
          <SortableContext 
            items={filteredItems.map(i => i.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className={styles.sortableList}>
              {filteredItems.map(item => (
                <SortableItem 
                  key={item.id} 
                  item={item} 
                  onEdit={handleOpenDrawer}
                  onStatusToggle={async (item: any) => {
                    await api.patch(`/menu/items/${item.id}`, { isActive: !item.isActive });
                    loadData();
                    toast.success(`${item.name} durumu güncellendi.`);
                  }}
                  onDelete={async (id: string) => {
                    if (confirm('Silmek istediğinize emin misiniz?')) {
                      await api.delete(`/menu/items/${id}`);
                      loadData();
                      toast.success('Ürün silindi.');
                    }
                  }}
                />
              ))}
              {filteredItems.length === 0 && (
                <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }}>
                  <UtensilsCrossed size={48} strokeWidth={1} style={{ margin: '0 auto 16px', opacity: 0.3 }} />
                  <p>Bu kategoride ürün bulunmuyor.</p>
                </div>
              )}
            </div>
          </SortableContext>
        </DndContext>
      </div>

      {/* ─── DRAWER FORM ───────────────────────────────── */}
      {isDrawerOpen && (
        <div className={styles.drawerOverlay} onClick={handleCloseDrawer}>
          <div className={styles.drawerContent} onClick={e => e.stopPropagation()}>
            <div className={styles.drawerHeader}>
              <h2 className={styles.drawerTitle}>{editingId ? 'Ürünü Düzenle' : 'Yeni Ürün Ekle'}</h2>
              <button className={styles.closeBtn} onClick={handleCloseDrawer}>
                <X size={24} />
              </button>
            </div>
            
            <form id="menu-form" onSubmit={handleSubmit} className={styles.drawerBody}>
              <div className={styles.field}>
                <label className={styles.label}>Ürün Adı</label>
                <input 
                  required 
                  className={styles.input} 
                  value={formData.name} 
                  onChange={e => setFormData({...formData, name: e.target.value})} 
                  placeholder="Örn: Izgara Dana Antrikot"
                />
              </div>

              <div className={styles.row}>
                <div className={styles.field} style={{flex: 1}}>
                  <label className={styles.label}>Kategori</label>
                  <select 
                    className={styles.input} 
                    value={formData.categoryId || activeCategory}
                    onChange={e => {
                      const categoryId = e.target.value;
                      const categoryName = categories.find((category) => category.id === categoryId)?.name || '';
                      setFormData({
                        ...formData,
                        categoryId,
                        ...(!editingId ? { department: suggestedDepartment(categoryName) } : {}),
                      });
                    }}
                  >
                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div className={styles.field} style={{flex: 1}}>
                  <label className={styles.label}>Fiyat (₺)</label>
                  <input 
                    required 
                    type="number" 
                    className={styles.input} 
                    value={formData.basePrice} 
                    onChange={e => setFormData({...formData, basePrice: e.target.value})}
                    placeholder="150"
                  />
                </div>
                <div className={styles.field} style={{flex: 1}}>
                  <label className={styles.label}>KDV Oranı (%)</label>
                  <select 
                    className={styles.input} 
                    value={formData.taxRate}
                    onChange={e => setFormData({...formData, taxRate: e.target.value})}
                  >
                    <option value="0">%0</option>
                    <option value="1">%1</option>
                    <option value="10">%10</option>
                    <option value="20">%20</option>
                  </select>
                </div>
              </div>

              <div className={styles.field}>
                <label className={styles.label}>Görsel URL</label>
                <input 
                  className={styles.input} 
                  value={formData.image} 
                  onChange={e => setFormData({...formData, image: e.target.value})}
                  placeholder="https://..."
                />
              </div>

              <div className={styles.field}>
                <label className={styles.label}>Kısa Açıklama</label>
                <textarea 
                  className={`${styles.input} ${styles.textarea}`} 
                  value={formData.description} 
                  onChange={e => setFormData({...formData, description: e.target.value})}
                  placeholder="Ürün içeriği veya menüde görünecek özet..."
                />
              </div>

              <div className={styles.row}>
                <div className={styles.field} style={{flex: 1}}>
                  <label className={styles.label}>Hazırlama İstasyonu</label>
                  <select
                    className={styles.input}
                    value={formData.department}
                    onChange={e => setFormData({...formData, department: e.target.value})}
                  >
                    <option value="KITCHEN">Taş Fırın / Fırın</option>
                    <option value="GRILL">Izgara / Mangal</option>
                    <option value="COLD">Soğuk Mutfak → Fırın Yazıcısı</option>
                    <option value="PASTRY">Pastane → Fırın Yazıcısı</option>
                    <option value="BAR">Bar / İçecek</option>
                  </select>
                </div>
                <div className={styles.field} style={{flex: 1}}>
                  <label className={styles.label}>Rozet</label>
                  <select 
                    className={styles.input} 
                    value={formData.badge}
                    onChange={e => setFormData({...formData, badge: e.target.value})}
                  >
                    <option value="">Yok</option>
                    <option value="Yeni">Yeni</option>
                    <option value="Popüler">Popüler</option>
                    <option value="Şefin Tavsiyesi">Şefin Tavsiyesi</option>
                  </select>
                </div>
                <div className={styles.field} style={{flex: 1}}>
                  <label className={styles.label}>Hazırlık Süresi (Dk)</label>
                  <input 
                    type="number" 
                    className={styles.input} 
                    value={formData.preparationTime} 
                    onChange={e => setFormData({...formData, preparationTime: e.target.value})}
                    placeholder="Örn: 15"
                  />
                </div>
              </div>

              <div className={styles.row}>
                <div className={styles.field} style={{flex: 1}}>
                  <label className={styles.label}>Kalori (kcal)</label>
                  <input
                    type="number"
                    className={styles.input}
                    value={formData.calories}
                    onChange={e => setFormData({...formData, calories: e.target.value})}
                    placeholder="Örn: 520"
                  />
                </div>
                <div className={styles.field} style={{flex: 2}}>
                  <label className={styles.label}>Alerjenler</label>
                  <input
                    className={styles.input}
                    value={formData.allergens}
                    onChange={e => setFormData({...formData, allergens: e.target.value})}
                    placeholder="Gluten, Süt, Yumurta (virgülle ayırın)"
                  />
                </div>
              </div>
            </form>

            <div className={styles.drawerFooter}>
              <button 
                type="button" 
                className={`${styles.btn} ${styles.btnSecondary}`} 
                style={{ flex: 1, justifyContent: 'center' }}
                onClick={handleCloseDrawer}
              >
                İptal
              </button>
              <button 
                type="submit" 
                form="menu-form" 
                className={`${styles.btn} ${styles.btnPrimary}`} 
                style={{ flex: 2, justifyContent: 'center' }}
              >
                <Save size={18} /> {editingId ? 'Değişiklikleri Kaydet' : 'Ürünü Ekle'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ─── CATEGORY DRAWER ─────────────────────────────────── */}
      {isCatDrawerOpen && (
        <div className={styles.drawerOverlay} onClick={() => setIsCatDrawerOpen(false)}>
          <div className={styles.drawer} onClick={e => e.stopPropagation()} style={{ width: '400px', maxWidth: '100%' }}>
            <div className={styles.drawerHeader}>
              <h2>{editingCatId ? 'Kategori Düzenle' : 'Yeni Kategori Ekle'}</h2>
              <button type="button" className={styles.iconBtn} onClick={() => setIsCatDrawerOpen(false)}><X size={24} /></button>
            </div>
            
            <div className={styles.drawerBody}>
              <div className={styles.field}>
                <label className={styles.label}>Kategori Adı <span style={{color: 'red'}}>*</span></label>
                <input 
                  type="text" 
                  className={styles.input} 
                  value={catName} 
                  onChange={(e) => setCatName(e.target.value)}
                  placeholder="Örn: Tatlılar" 
                  autoFocus
                />
              </div>
            </div>

            <div className={styles.drawerFooter}>
              <button 
                type="button" 
                className={`${styles.btn} ${styles.btnSecondary}`} 
                style={{ flex: 1, justifyContent: 'center' }} 
                onClick={() => setIsCatDrawerOpen(false)}
              >
                İptal
              </button>
              <button 
                type="button" 
                className={`${styles.btn} ${styles.btnPrimary}`} 
                style={{ flex: 2, justifyContent: 'center' }} 
                onClick={handleSaveCategory}
              >
                <Save size={18} /> {editingCatId ? 'Güncelle' : 'Kaydet'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── CATEGORY SORT MODAL ───────────────────────── */}
      {isCatSortModalOpen && (
        <div className={styles.drawerOverlay} onClick={() => setIsCatSortModalOpen(false)}>
          <div className={styles.drawerContent} onClick={e => e.stopPropagation()} style={{ maxWidth: '400px', width: '100%', margin: '0 auto', height: 'auto', maxHeight: '90vh', borderRadius: '16px', display: 'flex', flexDirection: 'column' }}>
            <div className={styles.drawerHeader}>
              <h2 className={styles.drawerTitle}>Kategorileri Sırala</h2>
              <button className={styles.closeBtn} onClick={() => setIsCatSortModalOpen(false)}>
                <X size={24} />
              </button>
            </div>
            
            <div className={styles.drawerBody} style={{ flex: 1, overflowY: 'auto' }}>
              <p style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem', marginBottom: '16px' }}>
                Kategorilerin sırasını sürükleyip bırakarak değiştirebilirsiniz.
              </p>
              <DndContext 
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleCategoryDragEnd}
                modifiers={[restrictToVerticalAxis]}
              >
                <SortableContext 
                  items={categories.map(c => c.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div>
                    {categories.map(cat => (
                      <SortableCategoryItem key={cat.id} cat={cat} />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            </div>

            <div className={styles.drawerFooter} style={{ borderTop: '1px solid var(--border)' }}>
              <button 
                type="button" 
                className={`${styles.btn} ${styles.btnSecondary}`} 
                style={{ flex: 1, justifyContent: 'center' }} 
                onClick={() => setIsCatSortModalOpen(false)}
              >
                İptal
              </button>
              <button 
                type="button" 
                className={`${styles.btn} ${styles.btnPrimary}`} 
                style={{ flex: 2, justifyContent: 'center' }} 
                onClick={saveCategorySortOrder}
                disabled={isSavingSort}
              >
                <Save size={18} /> {isSavingSort ? 'Kaydediliyor...' : 'Sıralamayı Kaydet'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

