import { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { PrefsForm } from "./components/PrefsForm";
import { api } from "./api";
import type { Settings } from "./settings";

function PreferencesApp() {
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    api.getSettings().then(setSettings);
  }, []);

  if (!settings) {
    return (
      <div style={{ padding: "24px", color: "var(--muted)" }}>Loading…</div>
    );
  }

  return (
    <PrefsForm
      settings={settings}
      onSave={(next) => {
        api.setSettings(next);
      }}
    />
  );
}

createRoot(document.getElementById("root")!).render(<PreferencesApp />);
