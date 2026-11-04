import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SkillsPanel } from "./SkillsPanel";
import { readUserSkills } from "../lib/api";

vi.mock("../lib/api", () => ({ readUserSkills: vi.fn() }));
const read = vi.mocked(readUserSkills);

describe("SkillsPanel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads and displays read-only skills with their provider and location", async () => {
    read.mockResolvedValue({ skills: [{ name: "review", description: "Review code", provider: "Claude Code", path: "/home/user/.claude/skills/review/SKILL.md" }], warnings: [] });
    render(<SkillsPanel refreshKey={0} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading skills");
    expect(await screen.findByText("review")).toBeInTheDocument();
    expect(screen.getByText("Review code")).toBeInTheDocument();
    expect(screen.getByText("Claude Code")).toBeInTheDocument();
    expect(screen.getByText("/home/user/.claude/skills/review/SKILL.md")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows an empty state and reloads on refresh", async () => {
    read.mockResolvedValue({ skills: [], warnings: [] });
    const view = render(<SkillsPanel refreshKey={0} />);
    expect(await screen.findByText("No enabled user skills found.")).toBeInTheDocument();
    view.rerender(<SkillsPanel refreshKey={1} />);
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  });

  it("shows read failures separately from an empty result", async () => {
    read.mockRejectedValue("Access denied");
    render(<SkillsPanel refreshKey={0} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Access denied");
    expect(screen.queryByText("No enabled user skills found.")).not.toBeInTheDocument();
  });

  it("shows partial discovery warnings", async () => {
    read.mockResolvedValue({ skills: [], warnings: ["Could not parse config.toml"] });
    render(<SkillsPanel refreshKey={0} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not parse config.toml");
    expect(screen.getByText("No skills could be listed.")).toBeInTheDocument();
  });
});
