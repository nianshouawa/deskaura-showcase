import React from 'react';
import { ThemeProvider } from './context/ThemeContext';
import { Navbar } from './components/Navbar';
import { Hero } from './components/Hero';
import { DesktopInteractionInverse } from './components/DesktopInteractionInverse';
import { CompanionStudioWindow } from './components/CompanionStudioWindow';
import { ArchitectureAndSecurity } from './components/ArchitectureAndSecurity';
import { DownloadsAndBoundaries } from './components/DownloadsAndBoundaries';
import { Footer } from './components/Footer';

export const App: React.FC = () => {
  return (
    <ThemeProvider>
      <div className="min-h-screen bg-[var(--bg-canvas)] text-[var(--text-primary)] transition-colors duration-200 overflow-x-hidden">
        {/* 1. Minimalist Top Navigation with Theme Switcher */}
        <Navbar />

        <main>
          {/* 2. Hero Section: Asymmetric Off-Center Layout on Adaptive Canvas */}
          <Hero />

          {/* 3. Real Desktop Interaction: Sandboxed Interactive Laboratory */}
          <DesktopInteractionInverse />

          {/* 4. Companion Studio: Authentic Dark Inverse Centerpiece */}
          <CompanionStudioWindow />

          {/* 5. System Architecture & 2D Security Model */}
          <ArchitectureAndSecurity />

          {/* 6. Distribution Formats & Plain Engineering Boundaries */}
          <DownloadsAndBoundaries />
        </main>

        {/* 7. Industrial Editorial Footer */}
        <Footer />
      </div>
    </ThemeProvider>
  );
};

export default App;
