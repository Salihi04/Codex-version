/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#172b4d',
        brand: { 50: '#eef6ff', 100: '#dbeafe', 500: '#2673d9', 600: '#1d5fb8', 700: '#194f98' },
        mint: { 50: '#ecfdf7', 100: '#d0fae8', 600: '#0b9872' },
      },
      boxShadow: {
        soft: '0 8px 28px rgba(21, 42, 74, 0.06)',
      },
    },
  },
  plugins: [],
};
