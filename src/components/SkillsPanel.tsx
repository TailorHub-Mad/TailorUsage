import { useEffect, useState } from "react";
import { readUserSkills } from "../lib/api";
import type { SkillsResult } from "../lib/types";

export function SkillsPanel({ refreshKey }: { refreshKey: number }) {
  const [result, setResult] = useState<SkillsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const filteredSkills = result?.skills.filter((skill) => skill.name.toLowerCase().includes(query)) ?? [];

  useEffect(() => {
    let active = true;
    setResult(null);
    setError(null);
    readUserSkills().then(
      (value) => { if (active) setResult(value); },
      (reason) => { if (active) setError(String(reason)); },
    );
    return () => { active = false; };
  }, [refreshKey]);

  return (
    <section className="px-4 py-3 text-xs min-h-48 max-h-96 overflow-y-auto">
      <h2 className="text-sm font-semibold text-gray-900">User skills</h2>
      <p className="mt-1 text-gray-500">Personal Claude Code and Codex skills. Read-only.</p>
      <p className="mt-1 text-gray-400">Project and plugin skills are not included.</p>
      <input
        type="search"
        aria-label="Search skills by name"
        placeholder="Search skills by name…"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        className="mt-3 w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      {!result && !error && <p role="status" className="py-6 text-gray-500">Loading skills…</p>}
      {error && <p role="alert" className="py-4 text-red-500">Could not load skills: {error}</p>}
      {result && (
        <>
          {result.warnings.length > 0 && (
            <div role="alert" className="mt-3 rounded-md bg-amber-50 p-2 text-amber-700 break-words">
              <p>Some skills could not be read.</p>
              {result.warnings.map((warning, index) => <p key={index} className="mt-1">{warning}</p>)}
            </div>
          )}
          <p className="mt-3 text-gray-500">{query ? `${filteredSkills.length} of ` : ""}{result.skills.length} enabled {result.skills.length === 1 ? "skill" : "skills"}</p>
          {result.skills.length === 0 ? (
            <p className="py-6 text-gray-500">{result.warnings.length ? "No skills could be listed." : "No enabled user skills found."}</p>
          ) : filteredSkills.length === 0 ? (
            <p role="status" className="py-6 text-gray-500">No skills match your search.</p>
          ) : (
            <ul aria-label="Enabled user skills" className="mt-2 max-h-80 overflow-y-auto divide-y divide-gray-100">
              {filteredSkills.map((skill) => (
                <li key={`${skill.provider}:${skill.path}`} className="py-3">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium text-gray-900 break-words min-w-0">{skill.name}</span>
                    <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">{skill.provider}</span>
                  </div>
                  {skill.description && <p className="mt-1 text-gray-500 break-words">{skill.description}</p>}
                  <p className="mt-1 text-[10px] text-gray-400 break-all">{skill.path}</p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
