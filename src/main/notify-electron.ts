import { Notification } from "electron";

export interface Notifier { send(title: string, message: string, url: string): Promise<void>; }

export function electronNotifier(enabled: () => boolean, onClick: (url: string) => void): Notifier {
  return {
    async send(title, message, url) {
      if (!enabled()) return;
      const n = new Notification({ title, body: message });
      n.on("click", () => onClick(url));
      n.show();
    },
  };
}
