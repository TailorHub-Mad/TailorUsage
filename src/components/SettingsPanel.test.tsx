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
