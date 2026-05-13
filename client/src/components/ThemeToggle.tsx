interface ThemeToggleProps {
  theme: "light" | "dark";
  onToggle: () => void;
}

export function ThemeToggle({ theme, onToggle }: ThemeToggleProps) {
  return (
    <button type="button" className="btn px-3 py-2 text-xs" onClick={onToggle} aria-label="Toggle theme">
      <span className="h-2 w-2 rounded-full" style={{ background: "rgb(var(--c-accent))" }} />
      {theme === "dark" ? "Dark" : "Light"}
      <span className="text-muted">·</span>
      <span className="text-muted">Switch</span>
    </button>
  );
}

