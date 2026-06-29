import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

afterEach(cleanup);
import { PrefsForm } from "../../src/renderer/src/components/PrefsForm";
import { DEFAULT_SETTINGS } from "../../src/renderer/src/settings";

describe("PrefsForm", () => {
  it("calls onSave with updated commentLanguage when Save is clicked", () => {
    const spy = vi.fn();
    render(<PrefsForm settings={DEFAULT_SETTINGS} onSave={spy} />);

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "ja" } });

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toMatchObject({ commentLanguage: "ja" });
  });

  it("preserves repoAllow and repoDeny in the saved object", () => {
    const spy = vi.fn();
    const settings = {
      ...DEFAULT_SETTINGS,
      repoAllow: ["org/repo-a"],
      repoDeny: ["org/repo-b"],
    };
    render(<PrefsForm settings={settings} onSave={spy} />);
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(spy.mock.calls[0][0].repoAllow).toEqual(["org/repo-a"]);
    expect(spy.mock.calls[0][0].repoDeny).toEqual(["org/repo-b"]);
  });
});
