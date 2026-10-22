/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#f7f8f5',
        ink: '#202622',
        forest: '#214b3b',
        sage: '#e7eee8',
        line: '#e5e8e2',
      },
      fontFamily: { sans: ['DM Sans', 'sans-serif'], display: ['Manrope', 'sans-serif'] },
    },
  },
  plugins: [],
};
