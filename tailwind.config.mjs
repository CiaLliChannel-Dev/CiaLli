/** @type {import('tailwindcss').Config} */
import typography from "@tailwindcss/typography";

export default {
    content: ["./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue,mjs}"],
    darkMode: "class",
    theme: {
        extend: {
            fontFamily: {
                sans: ["var(--font-sans)"],
                mono: ["var(--font-mono)"],
            },
            screens: {
                md: "768px",
                lg: "1280px",
            },
        },
    },
    plugins: [typography],
};
