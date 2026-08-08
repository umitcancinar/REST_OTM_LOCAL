'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

interface LayoutContextType {
  isCollapsed: boolean;
  isMobileMenuOpen: boolean;
  toggleSidebar: () => void;
  toggleMobileMenu: () => void;
  closeMobileMenu: () => void;
}

const LayoutContext = createContext<LayoutContextType | undefined>(undefined);

export function LayoutProvider({ children }: { children: React.ReactNode }) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Load preference from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('sidebar-collapsed');
    if (saved === 'true') setIsCollapsed(true);
  }, []);

  const toggleSidebar = () => {
    setIsCollapsed(prev => {
      const newState = !prev;
      localStorage.setItem('sidebar-collapsed', String(newState));
      return newState;
    });
  };

  const toggleMobileMenu = () => setIsMobileMenuOpen(prev => !prev);
  const closeMobileMenu = () => setIsMobileMenuOpen(false);

  return (
    <LayoutContext.Provider value={{ isCollapsed, isMobileMenuOpen, toggleSidebar, toggleMobileMenu, closeMobileMenu }}>
      {children}
    </LayoutContext.Provider>
  );
}

export function useLayout() {
  const context = useContext(LayoutContext);
  if (context === undefined) {
    throw new Error('useLayout must be used within a LayoutProvider');
  }
  return context;
}
