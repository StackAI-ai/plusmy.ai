import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}'
  ],
  theme: {
    extend: {
      colors: {
        canvas: '#f4efe6',
        ink: '#13201d',
        ember: '#f06432',
        moss: '#2d5a44',
        brass: '#c8a24d'
      },
      boxShadow: {
        panel: '0 20px 60px rgba(19, 32, 29, 0.12)'
      }
    }
  },
  plugins: []
};

export default config;
