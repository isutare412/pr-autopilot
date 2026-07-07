import { Menu } from "electron";

export interface AppMenuHandlers {
  onPreferences: () => void;
  onPollNow: () => void;
}

export function installAppMenu(h: AppMenuHandlers): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "PR Autopilot",
      submenu: [
        { role: "about" },
        { type: "separator" },
        { label: "Preferences…", accelerator: "CmdOrCtrl+,", click: () => h.onPreferences() },
        { label: "Poll Now", accelerator: "CmdOrCtrl+R", click: () => h.onPollNow() },
        { type: "separator" },
        { role: "hide" }, { role: "hideOthers" }, { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
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
