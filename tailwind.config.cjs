module.exports = {
  darkMode: 'class',
  content: ['./index.html', './index.tsx', './App.tsx', './components/**/*.{ts,tsx}', './services/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        gray: {
          50: '#f7f7f8',
          100: '#ececf1',
          200: '#d9d9e3',
          300: '#c5c5d5',
          400: '#acacbe',
          500: '#9292a8',
          600: '#797991',
          700: '#61617b',
          800: '#494964',
          900: '#31314e',
          950: '#1f1f33',
        },
      },
    },
  },
  plugins: [],
};
