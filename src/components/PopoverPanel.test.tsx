import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PopoverPanel } from "./PopoverPanel";
import { readUserSkills } from "../lib/api";

vi.mock("../hooks/usePolling", () => ({ usePolling: () => ({ refresh: vi.fn() }) }));
vi.mock("../lib/api", () => ({
  resizeWindow: vi.fn().mockResolvedValue(undefined),
  readUserSkills: vi.fn().mockResolvedValue({ skills: [], warnings: [] }),
}));
vi.mock("./UsageLimitsBar", () => ({ UsageLimitsBar: () => <div>Usage limits</div> }));
vi.mock("./sections/WeekSection", () => ({ WeekSection: () => <div>Week usage</div> }));
vi.mock("./sections/ProxyToggle", () => ({
  ProxySwitch: () => null, ProxyToggle: () => null, ProxyMessage: () => null,
  useProxyToggleControl: () => ({ loading: false, error: null, showMessage: false, handleProxyToggle: vi.fn() }),
}));
vi.mock("./SettingsPanel", () => ({ SettingsPanel: ({ onClose }: { onClose: () => void }) => <button onClick={onClose}>Close settings</button> }));

describe("PopoverPanel navigation", () => {
  it("opens skills, refreshes, returns from settings, and switches back to usage", async () => {
    const user = userEvent.setup();
    render(<PopoverPanel />);
    expect(screen.getByText("Usage limits")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Skills" }));
    expect(await screen.findByText("No enabled user skills found.")).toBeInTheDocument();
    expect(screen.queryByText("Usage limits")).not.toBeInTheDocument();
    await user.click(screen.getByTitle("Refresh now"));
    await waitFor(() => expect(readUserSkills).toHaveBeenCalledTimes(2));
    await user.click(screen.getByTitle("Settings"));
    await user.click(screen.getByText("Close settings"));
    expect(await screen.findByText("No enabled user skills found.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Usage" }));
    expect(screen.getByText("Usage limits")).toBeInTheDocument();
    expect(screen.getByText("Week usage")).toBeInTheDocument();
  });
});
