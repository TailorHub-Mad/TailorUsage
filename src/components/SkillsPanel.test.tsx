import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

  it("filters by partial skill name regardless of case and restores all skills when cleared", async () => {
    const user = userEvent.setup();
    read.mockResolvedValue({ skills: [
      { name: "code-review", description: "Review code", provider: "Claude Code", path: "/skills/code-review/SKILL.md" },
      { name: "Review-tests", description: "Check tests", provider: "Codex", path: "/skills/Review-tests/SKILL.md" },
      { name: "deploy", description: "Review deployments", provider: "Codex", path: "/skills/review-deploy/SKILL.md" },
    ], warnings: [] });
    render(<SkillsPanel refreshKey={0} />);
    const list = await screen.findByRole("list", { name: "Enabled user skills" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    const search = screen.getByRole("searchbox", { name: "Search skills by name" });

    await user.type(search, "  REVIEW  ");
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).getByText("code-review")).toBeInTheDocument();
    expect(within(list).getByText("Review-tests")).toBeInTheDocument();
    expect(screen.queryByText("deploy")).not.toBeInTheDocument();
    expect(screen.getByText("2 of 3 enabled skills")).toBeInTheDocument();

    await user.clear(search);
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("3 enabled skills")).toBeInTheDocument();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("shows a no-match state and recovers when the search changes", async () => {
    const user = userEvent.setup();
    read.mockResolvedValue({ skills: [
      { name: "review", description: "Review code", provider: "Codex", path: "/skills/review/SKILL.md" },
    ], warnings: [] });
    render(<SkillsPanel refreshKey={0} />);
    await screen.findByText("review");
    const search = screen.getByRole("searchbox", { name: "Search skills by name" });
    await user.type(search, "missing");
    expect(screen.getByRole("status")).toHaveTextContent("No skills match your search.");
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.queryByText("No enabled user skills found.")).not.toBeInTheDocument();
    await user.clear(search);
    await user.type(search, "rev");
    expect(screen.getByText("review")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
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
