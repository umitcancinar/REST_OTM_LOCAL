'use client';

import React, { useState, useEffect, useRef } from 'react';
import { GripHorizontal } from 'lucide-react';

interface DynamicResizerProps {
  onResize: (height: number) => void;
  minHeight?: number;
  maxHeight?: number;
  initialHeight?: number;
}

export default function DynamicResizer({ 
  onResize, 
  minHeight = 100, 
  maxHeight = 800, 
  initialHeight = 400 
}: DynamicResizerProps) {
  const [isResizing, setIsResizing] = useState(false);
  const dividerRef = useRef<HTMLDivElement>(null);

  const startResizing = (e: React.MouseEvent | React.TouchEvent) => {
    setIsResizing(true);
    e.preventDefault();
  };

  const stopResizing = () => {
    setIsResizing(false);
  };

  const resize = (e: MouseEvent | TouchEvent) => {
    if (!isResizing) return;

    let clientY: number;
    if (e instanceof MouseEvent) {
      clientY = e.clientY;
    } else {
      clientY = e.touches[0].clientY;
    }

    // Get the top offset of the container if needed, but here we can just use the Y position 
    // relative to the parent or simply update the state and let the parent handle the math.
    // For simplicity, we'll pass the raw Y or a calculated height.
    onResize(clientY);
  };

  useEffect(() => {
    if (isResizing) {
      window.addEventListener('mousemove', resize);
      window.addEventListener('mouseup', stopResizing);
      window.addEventListener('touchmove', resize);
      window.addEventListener('touchend', stopResizing);
    } else {
      window.removeEventListener('mousemove', resize);
      window.removeEventListener('mouseup', stopResizing);
      window.removeEventListener('touchmove', resize);
      window.removeEventListener('touchend', stopResizing);
    }

    return () => {
      window.removeEventListener('mousemove', resize);
      window.removeEventListener('mouseup', stopResizing);
      window.removeEventListener('touchmove', resize);
      window.removeEventListener('touchend', stopResizing);
    };
  }, [isResizing]);

  return (
    <div 
      ref={dividerRef}
      onMouseDown={startResizing}
      onTouchStart={startResizing}
      style={{
        height: '24px',
        width: '100%',
        background: 'var(--bg-elevated)',
        borderTop: '1px solid var(--border)',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'ns-resize',
        zIndex: 10,
        touchAction: 'none',
        position: 'relative'
      }}
    >
      <div style={{
        width: '40px',
        height: '4px',
        background: 'var(--border-strong)',
        borderRadius: '2px',
        opacity: 0.5
      }} />
      <div style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        color: 'var(--text-tertiary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-surface)',
        padding: '2px 8px',
        borderRadius: '10px',
        border: '1px solid var(--border)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
      }}>
        <GripHorizontal size={14} />
      </div>
    </div>
  );
}
