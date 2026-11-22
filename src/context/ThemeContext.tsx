import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

export type ThemePreference = 'system' | 'dark' | 'light';
export type ActualTheme = 'dark' | 'light';

interface ThemeContextType {
  themePreference: ThemePreference;
  actualTheme: ActualTheme;
  setThemePreference: (pref: ThemePreference) => void;
  cycleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const STORAGE_KEY = 'deskaura-theme';

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>(() => {
    if (typeof window === 'undefined') return 'system';
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'dark' || saved === 'light' || saved === 'system') {
        return saved;
      }
    } catch {}
    return 'system';
  });

  const [systemIsDark, setSystemIsDark] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  // Listen to system prefers-color-scheme changes
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    
    const handleChange = (e: MediaQueryListEvent) => {
      setSystemIsDark(e.matches);
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  const actualTheme: ActualTheme = themePreference === 'system'
    ? (systemIsDark ? 'dark' : 'light')
    : themePreference;

  // Apply data-theme and class to html root
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.setAttribute('data-theme', actualTheme);
    if (actualTheme === 'dark') {
      root.classList.add('dark');
      root.classList.remove('light');
    } else {
      root.classList.add('light');
      root.classList.remove('dark');
    }
  }, [actualTheme]);

  const setThemePreference = useCallback((pref: ThemePreference) => {
    setThemePreferenceState(pref);
    try {
      localStorage.setItem(STORAGE_KEY, pref);
    } catch {}
  }, []);

  const cycleTheme = useCallback(() => {
    setThemePreferenceState((prev) => {
      let next: ThemePreference = 'system';
      if (prev === 'system') next = 'dark';
      else if (prev === 'dark') next = 'light';
      else if (prev === 'light') next = 'system';
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {}
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ themePreference, actualTheme, setThemePreference, cycleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeContextType => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
