import { Menu } from "electron";

export function installAppMenu(onPreferences: () => void): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "PR Autopilot",
      submenu: [
        { role: "about" },
        { type: "separator" },
        { label: "Preferences…", accelerator: "CmdOrCtrl+,", click: () => onPreferences() },
        { type: "separator" },
        { role: "hide" }, { role: "hideOthers" }, { role: "unhide" },
        { type: "separator" },
        { role: "quit" }, // Cmd+Q → app.quit(); the before-quit flag (Step 2) lets the window actually close
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" }, { role: "redo" }, { type: "separator" },
        { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" },
      ],
    },
    { label: "Window", submenu: [{ role: "minimize" }, { role: "close" }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
