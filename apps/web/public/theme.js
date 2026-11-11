// Pick the theme before first paint (saved choice, else the system's). A file, not inline, so the CSP needs no hash.
document.documentElement.classList.toggle("dark", (localStorage.getItem("passforge.theme") ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")) === "dark")
