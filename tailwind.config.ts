import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        board: {
          dark: '#3f3c52',
          light: '#c8d3d5',
          lake: '#2f6690',
        },
      },
      boxShadow: {
        card: '0 12px 26px rgba(16, 24, 40, 0.18)',
      },
      fontFamily: {
        display: ['Segoe UI', 'Tahoma', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
