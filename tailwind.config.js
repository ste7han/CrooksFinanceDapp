// tailwind.config.js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'Inter', // 👈 moderne font
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'Noto Sans',
          'sans-serif',
        ],
      },
      colors: {
        // 👇 extra transparante kleuren voor mooie overlays
        glass: 'rgba(255,255,255,0.05)',
        glassLight: 'rgba(255,255,255,0.1)',
        crooks: {
          green: '#10b981',
          dark: '#0f172a',
        },
      },
      boxShadow: {
        soft: '0 10px 40px -10px rgba(0,0,0,0.5)', // voor de glass cards
      },
      backdropBlur: {
        xs: '2px',
      },
      animation: {
        shimmer: 'shimmer 1.6s infinite',
      },
      keyframes: {
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
    },
  },
  plugins: [],
};
