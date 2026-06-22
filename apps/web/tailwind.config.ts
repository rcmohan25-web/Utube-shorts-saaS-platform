import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f4f3ff',
          500: '#6d5bff',
          600: '#5945e6',
          900: '#1c1530',
        },
      },
    },
  },
  plugins: [],
};
export default config;
