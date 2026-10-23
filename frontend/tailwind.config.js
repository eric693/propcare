/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#0f6b6f', dark: '#0a4e52', light: '#e3f1f1', 50: '#f2f8f8' },
        warm: '#f4f6f5',
      },
      fontFamily: { sans: ['"Noto Sans TC"', '"PingFang TC"', '"Microsoft JhengHei"', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
};
