'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { useToast } from '@/components/ui/Toast';

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  time: string;
  read: boolean;
  type: 'order' | 'waiter' | 'system';
}

interface NotificationContextType {
  notifications: NotificationItem[];
  unreadCount: number;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  socket: Socket | null;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [socket, setSocket] = useState<Socket | null>(null);
  const toast = useToast();

  useEffect(() => {
    // Socket.io Kurulumu
    const token = localStorage.getItem('accessToken');
    if (!token) return;

    const socketOptions = { auth: { token }, transports: ['websocket'] as ['websocket'] };
    const socketUrl = process.env.NEXT_PUBLIC_WS_URL
      || process.env.NEXT_PUBLIC_API_URL?.replace(/\/api\/?$/, '');
    const newSocket = socketUrl ? io(socketUrl, socketOptions) : io(socketOptions);

    setSocket(newSocket);

    // Yeni Sipariş Dinleyicisi (Genellikle mutfak için ama garson da görebilir)
    newSocket.on('order:new', (data) => {
      const { order } = data;
      // Sadece kendi paket siparişleri veya masa güncellemeleri için
      const title = `Yeni Sipariş: Masa ${order.table?.number || '?'}`;
      const message = `Tutar: ₺${order.grandTotal}`;
      
      addNotification({
        id: order.id,
        title,
        message,
        time: new Date().toISOString(),
        read: false,
        type: 'order'
      });
      
      toast.success(title);
    });

    // Mutfak Hazır Bildirimi (Opsiyonel: İleride eklenebilir)
    newSocket.on('kitchen:item_ready', (data) => {
       const title = `✅ Sipariş Hazır!`;
       const message = `Masa ${data.tableNumber} için ${data.itemName} hazır.`;
       toast.success(title);
    });

    return () => {
      newSocket.disconnect();
    };
  }, []);

  const addNotification = (item: NotificationItem) => {
    setNotifications(prev => [item, ...prev].slice(0, 50));
  };

  const markAsRead = (id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  };

  const markAllAsRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <NotificationContext.Provider value={{ notifications, unreadCount, markAsRead, markAllAsRead, socket }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) throw new Error('useNotifications must be used within NotificationProvider');
  return context;
}
