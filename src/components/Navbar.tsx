import React, { useState, useEffect } from 'react';
import { Menu, X, Sun, Moon, Monitor } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

export const Navbar: React.FC = () => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { themePreference, actualTheme, setThemePreference } = useTheme();

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const navLinks = [
    { name: '桌面交互', href: '#desktop-interaction' },
    { name: '角色工作室', href: '#companion-studio' },
    { name: '系统架构', href: '#architecture' },
    { name: '下载', href: '#downloads' },
  ];

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-colors duration-200 border-b ${
        isScrolled
          ? 'bg-[var(--nav-blur-scrolled)] backdrop-blur-md border-[var(--border-hairline)] shadow-xs'
          : 'bg-[var(--nav-blur-bg)] backdrop-blur-sm border-[var(--border-hairline)]'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
        {/* Left: DeskAura + // v0.1.0 */}
        <a href="#" className="flex items-center gap-2 group focus:outline-none">
          <div className="w-5 h-5 rounded bg-[var(--bg-elevated)] border border-[var(--accent-signal)]/40 flex items-center justify-center overflow-hidden">
            <img src={`${import.meta.env.BASE_URL}app-icon.png`} alt="DeskAura" className="w-4 h-4 object-contain" />
          </div>
          <span className="font-display font-bold text-base tracking-tight text-[var(--text-primary)]">
            DeskAura
          </span>
          <span className="text-[11px] font-mono-code text-[var(--text-muted)] tracking-wider">
            // v0.1.0
          </span>
        </a>

        {/* Center: 4 Nav links in HarmonyOS Sans SC */}
        <nav className="hidden md:flex items-center gap-8">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-xs font-sans-ui font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors tracking-wide"
            >
              {link.name}
            </a>
          ))}
        </nav>

        {/* Right: Theme Switcher & Action Button */}
        <div className="hidden sm:flex items-center gap-3 lg:gap-4">
          <span className="text-[11px] font-mono-code text-[var(--text-muted)] hidden xl:inline">
            WIN_X64 // 8000:8001:8002
          </span>

          {/* Theme Switcher (AUTO / DARK / LIGHT) */}
          <div className="flex items-center p-0.5 bg-[var(--bg-elevated)] border border-[var(--border-hairline)] rounded-xs font-mono-code text-[10px]">
            <button
              onClick={() => setThemePreference('system')}
              title={`跟随系统 (${actualTheme === 'dark' ? '深色' : '浅色'})`}
              className={`px-2 py-1 flex items-center gap-1 transition-colors cursor-pointer rounded-xs ${
                themePreference === 'system'
                  ? 'bg-[var(--accent-signal)] text-white font-bold shadow-xs'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Monitor className="w-3 h-3" />
              <span className="hidden lg:inline">AUTO</span>
            </button>
            <button
              onClick={() => setThemePreference('dark')}
              title="深色模式 (Dark)"
              className={`px-2 py-1 flex items-center gap-1 transition-colors cursor-pointer rounded-xs ${
                themePreference === 'dark'
                  ? 'bg-[var(--bg-surface)] text-[var(--accent-signal)] border border-[var(--border-hairline)] font-bold shadow-xs'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Moon className="w-3 h-3" />
              <span className="hidden lg:inline">DARK</span>
            </button>
            <button
              onClick={() => setThemePreference('light')}
              title="纸白浅色 (Light)"
              className={`px-2 py-1 flex items-center gap-1 transition-colors cursor-pointer rounded-xs ${
                themePreference === 'light'
                  ? 'bg-[var(--bg-surface)] text-[var(--accent-signal)] border border-[var(--border-hairline)] font-bold shadow-xs'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Sun className="w-3 h-3" />
              <span className="hidden lg:inline">LIGHT</span>
            </button>
          </div>

          <a
            href="#downloads"
            className="cut-corner-tr bg-[var(--accent-solid)] hover:bg-[var(--accent-solid-hover)] text-white font-sans-ui font-medium text-xs px-4 py-2 tracking-[0.02em] transition-colors focus:outline-none shadow-xs"
          >
            获取 Windows 版
          </a>
        </div>

        {/* Mobile Menu Toggle & Compact Theme Toggle */}
        <div className="flex md:hidden items-center gap-2">
          {/* Quick theme cycle on mobile (>= 44px touch area) */}
          <button
            onClick={() => setThemePreference(themePreference === 'dark' ? 'light' : themePreference === 'light' ? 'system' : 'dark')}
            className="min-h-[44px] min-w-[44px] px-2 border border-[var(--border-hairline)] rounded bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs font-mono-code flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
            title="切换主题 (AUTO / DARK / LIGHT)"
            aria-label="切换主题"
          >
            {actualTheme === 'dark' ? (
              <Moon className="w-4 h-4 text-[var(--accent-signal)]" />
            ) : (
              <Sun className="w-4 h-4 text-[var(--accent-signal)]" />
            )}
            <span className="text-[10px] font-bold">{themePreference.toUpperCase()}</span>
          </button>

          {/* MENU Drawer Switch (>= 44px touch area) */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="min-h-[44px] min-w-[44px] px-2.5 border border-[var(--border-hairline)] rounded bg-[var(--bg-elevated)] text-[var(--text-primary)] hover:text-[var(--accent-signal)] flex items-center justify-center gap-1.5 cursor-pointer font-mono-code text-xs transition-colors"
            aria-label="Toggle Navigation Menu"
          >
            {mobileMenuOpen ? (
              <>
                <X className="w-4 h-4 text-[var(--accent-signal)]" />
                <span className="text-[11px] font-bold">CLOSE</span>
              </>
            ) : (
              <>
                <Menu className="w-4 h-4 text-[var(--accent-signal)]" />
                <span className="text-[11px] font-bold">MENU</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Mobile Drawer (Smooth 200ms Transition) */}
      <div
        className={`md:hidden overflow-hidden transition-all duration-200 ease-out bg-[var(--bg-surface)] border-b border-[var(--border-hairline)] shadow-xl ${
          mobileMenuOpen ? 'max-h-[480px] opacity-100 py-4 px-5' : 'max-h-0 opacity-0 py-0 px-5 border-none'
        }`}
      >
        <div className="flex flex-col gap-1 text-sm">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={() => setMobileMenuOpen(false)}
              className="min-h-[44px] font-sans-ui text-[var(--text-primary)] hover:text-[var(--accent-signal)] flex items-center border-b border-[var(--border-hairline)]/50 tracking-wide font-medium transition-colors"
            >
              <span className="font-mono-code text-[var(--accent-signal)] mr-2">//</span>
              {link.name}
            </a>
          ))}

          {/* Mobile Theme Segmented Controls */}
          <div className="pt-3 pb-1 flex items-center justify-between text-xs">
            <span className="font-mono-code text-[11px] text-[var(--text-muted)]">THEME //</span>
            <div className="flex items-center p-0.5 bg-[var(--bg-elevated)] border border-[var(--border-hairline)] rounded font-mono-code text-[11px]">
              <button
                onClick={() => setThemePreference('system')}
                className={`min-h-[36px] px-3 py-1.5 rounded transition-colors cursor-pointer flex items-center gap-1 ${
                  themePreference === 'system'
                    ? 'bg-[var(--accent-signal)] text-white font-bold shadow-xs'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                <Monitor className="w-3.5 h-3.5" />
                <span>AUTO</span>
              </button>
              <button
                onClick={() => setThemePreference('dark')}
                className={`min-h-[36px] px-3 py-1.5 rounded transition-colors cursor-pointer flex items-center gap-1 ${
                  themePreference === 'dark'
                    ? 'bg-[var(--accent-signal)] text-white font-bold shadow-xs'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                <Moon className="w-3.5 h-3.5" />
                <span>DARK</span>
              </button>
              <button
                onClick={() => setThemePreference('light')}
                className={`min-h-[36px] px-3 py-1.5 rounded transition-colors cursor-pointer flex items-center gap-1 ${
                  themePreference === 'light'
                    ? 'bg-[var(--accent-signal)] text-white font-bold shadow-xs'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                <Sun className="w-3.5 h-3.5" />
                <span>LIGHT</span>
              </button>
            </div>
          </div>

          <a
            href="#downloads"
            onClick={() => setMobileMenuOpen(false)}
            className="mt-3 min-h-[44px] text-center cut-corner-tr bg-[var(--accent-solid)] hover:bg-[var(--accent-solid-hover)] text-white font-sans-ui font-medium flex items-center justify-center tracking-[0.02em] shadow-xs cursor-pointer transition-colors"
          >
            获取 Windows 版
          </a>

          {/* Technical Footnote */}
          <div className="pt-2 text-center font-mono-code text-[10px] text-[var(--text-muted)]">
            PORTS: 8000:8001:8002 · WIN_X64 · BUILD 2026.11
          </div>
        </div>
      </div>
    </header>
  );
};
