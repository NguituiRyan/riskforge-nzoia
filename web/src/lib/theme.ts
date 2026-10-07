export type Theme = "dark" | "light";

const KEY = "rf-theme";

/** the theme index.html already applied before React started (saved choice, else the system setting) */
export function initialTheme(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function applyTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t === "light" ? "#e9ecfb" : "#000418");
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* private mode or blocked storage: the theme still applies for this visit */
  }
}
