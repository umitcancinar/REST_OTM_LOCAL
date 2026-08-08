'use client';

import { Sun, Moon } from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';
import styles from './ThemeToggle.module.css';

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      className={styles.toggle}
      aria-label={theme === 'light' ? 'Karanlık moda geç' : 'Aydınlık moda geç'}
      title={theme === 'light' ? 'Karanlık Mod' : 'Aydınlık Mod'}
    >
      <span className={`${styles.track} ${theme === 'dark' ? styles.dark : ''}`}>
        <span className={`${styles.thumb} ${theme === 'dark' ? styles.thumbDark : ''}`}>
          {theme === 'light' ? (
            <Sun size={11} strokeWidth={2.5} />
          ) : (
            <Moon size={11} strokeWidth={2.5} />
          )}
        </span>
      </span>
    </button>
  );
}
