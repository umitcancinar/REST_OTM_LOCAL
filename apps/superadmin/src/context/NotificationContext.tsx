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
    // Web Notification İzni Al (İşletim Sistemi Seviyesi)
    // Not: Modern tarayıcılar bu isteğin kullanıcı bir butona tıkladığında yapılmasını zorunlu tutar.
    // Otomatik yapıldığında konsolda "Notification prompting can only be done from a user gesture" hatası verir.

    // Socket.io Kurulumu
    const token = localStorage.getItem('accessToken');
    if (!token) return;

    const newSocket = io(process.env.NEXT_PUBLIC_API_URL?.replace('/api', '') || 'http://localhost:4000', {
      auth: { token },
      transports: ['websocket']
    });

    setSocket(newSocket);

    // Yeni Sipariş Dinleyicisi
    newSocket.on('order:new', (data) => {
      const { order } = data;
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
      
      triggerOSNotification(title, message);
      toast.success(title);
    });

    // Garson Çağrısı Dinleyicisi
    newSocket.on('waiter:called', (data) => {
      const { tableId, time } = data;
      const title = `🔔 Garson Çağrısı!`;
      const message = `Masa ${tableId} garson çağırıyor.`;

      addNotification({
        id: `waiter-${tableId}-${time}`,
        title,
        message,
        time,
        read: false,
        type: 'waiter'
      });

      triggerOSNotification(title, message);
      toast.warning(title); // Toast ile uyarı
    });

    return () => {
      newSocket.disconnect();
    };
  }, []); // eslint-disable-next-line react-hooks/exhaustive-deps

  const addNotification = (item: NotificationItem) => {
    setNotifications(prev => [item, ...prev].slice(0, 50)); // Son 50'yi tut
  };

  const triggerOSNotification = (title: string, body: string) => {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body, icon: '/icons/icon-192.png' });
    }
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
