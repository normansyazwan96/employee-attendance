/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: { ink: "#202d32", brand: { 500: "#167a70", 600: "#11675f", 50: "#e8f5f1" } },
      spacing: { 13: "3.25rem" },
      boxShadow: { card: "0 12px 36px rgba(30, 61, 68, 0.08)" },
    },
  },
  plugins: [],
};
