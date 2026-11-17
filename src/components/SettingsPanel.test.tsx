import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "../store";
import { SettingsPanel } from "./SettingsPanel";

const apiMocks = vi.hoisted(() => ({
  setPreferences: vi.fn(),
  setLaunchAtLogin: vi.fn(),
  setHideFromDock: vi.fn(),
}));

vi.mock("../lib/api", () => apiMocks);

describe("SettingsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.setPreferences.mockResolvedValue(undefined);
    apiMocks.setLaunchAtLogin.mockResolvedValue(undefined);
    apiMocks.setHideFromDock.mockResolvedValue(undefined);
    useStore.setState({
      preferences: {
        poll_interval: 900000,
        tray_display: "tokens",
        tray_source: "claude",
        notification_threshold: null,
        visible_providers: ["claude", "openai"],
      },
      launchAtLogin: false,
      hideFromDock: false,
    });
  });

  it("shows the ordered notification choices with Off selected by default", () => {
    render(<SettingsPanel onClose={vi.fn()} />);

    expect(screen.getAllByRole("button", { name: /^(Off|\d+%)$/ }).map((button) => button.textContent))
      .toEqual(["Off", "60%", "70%", "80%", "90%"]);
    expect(screen.getByRole("button", { name: "Off" })).toHaveClass("bg-gray-100");
  });

  it("selects and saves 60%, then switches back to Off without changing other preferences", async () => {
    const originalPreferences = useStore.getState().preferences;
    render(<SettingsPanel onClose={vi.fn()} />);

    for (const [label, threshold] of [["60%", 60], ["Off", null]] as const) {
      fireEvent.click(screen.getByRole("button", { name: label }));

      const expected = { ...originalPreferences, notification_threshold: threshold };
      await waitFor(() => {
        expect(apiMocks.setPreferences).toHaveBeenLastCalledWith(expected);
      });
      expect(useStore.getState().preferences).toEqual(expected);
      expect(screen.getByRole("button", { name: label })).toHaveClass("bg-gray-100");
      expect(screen.getByRole("button", { name: threshold === null ? "60%" : "Off" }))
        .not.toHaveClass("bg-gray-100");
    }
  });

  it.each([60, 70, 80, 90])("highlights a restored %i%% preference", (threshold) => {
    useStore.getState().setPreferences({
      ...useStore.getState().preferences,
      notification_threshold: threshold,
    });
    render(<SettingsPanel onClose={vi.fn()} />);

    expect(screen.getByRole("button", { name: `${threshold}%` })).toHaveClass("bg-gray-100");
    expect(screen.getByRole("button", { name: "Off" })).not.toHaveClass("bg-gray-100");
    expect(apiMocks.setPreferences).not.toHaveBeenCalled();
  });

  it("hides a provider and moves the tray source to the remaining provider", async () => {
    render(<SettingsPanel onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Hide Claude provider" }));

    await waitFor(() => {
      expect(useStore.getState().preferences).toMatchObject({
        tray_source: "openai",
        visible_providers: ["openai"],
      });
      expect(apiMocks.setPreferences).toHaveBeenCalledWith(
        expect.objectContaining({ tray_source: "openai", visible_providers: ["openai"] }),
      );
    });

    expect(screen.queryByRole("button", { name: "Claude" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide OpenAI provider" })).toBeDisabled();
  });

  it("does not allow the final provider to be hidden", () => {
    useStore.setState({
      preferences: {
        ...useStore.getState().preferences,
        tray_source: "openai",
        visible_providers: ["openai"],
      },
    });

    render(<SettingsPanel onClose={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Hide OpenAI provider" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Show Claude provider" })).toBeEnabled();
  });
});
