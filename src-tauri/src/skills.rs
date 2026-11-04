use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    io::ErrorKind,
    path::{Path, PathBuf},
};

#[derive(Debug, Serialize)]
pub struct UserSkill {
    name: String,
    description: String,
    provider: String,
    path: String,
}

#[derive(Default, Serialize)]
pub struct SkillsResult {
    skills: Vec<UserSkill>,
    warnings: Vec<String>,
}

#[derive(Default, Deserialize)]
struct Metadata {
    name: Option<String>,
    description: Option<String>,
}

#[derive(Default, Deserialize)]
struct Config {
    #[serde(default)]
    skills: SkillConfig,
}

#[derive(Default, Deserialize)]
struct SkillConfig {
    #[serde(default)]
    config: Vec<SkillRule>,
}

#[derive(Deserialize)]
struct SkillRule {
    path: Option<PathBuf>,
    name: Option<String>,
    enabled: bool,
}

fn read_optional(path: &Path) -> Result<Option<String>, String> {
    match fs::read_to_string(path) {
        Ok(text) => Ok(Some(text)),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("Could not read {}: {error}", path.display())),
    }
}

fn metadata(text: &str) -> Result<Metadata, String> {
    let mut lines = text.trim_start_matches('\u{feff}').lines();
    if lines.next() != Some("---") {
        return Ok(Metadata::default());
    }
    let mut header = Vec::new();
    for line in lines {
        if line == "---" {
            return serde_yaml::from_str(&header.join("\n")).map_err(|e| e.to_string());
        }
        header.push(line);
    }
    Err("Unclosed YAML frontmatter".into())
}

fn enabled(skill: &UserSkill, rules: &[SkillRule]) -> bool {
    let path = Path::new(&skill.path);
    rules
        .iter()
        .filter(|rule| {
            rule.name.as_deref() == Some(&skill.name)
                || rule.path.as_ref().is_some_and(|p| {
                    p == path
                        || p == path.parent().unwrap_or(path)
                        || fs::canonicalize(p)
                            .ok()
                            .is_some_and(|p| p == path || Some(p.as_path()) == path.parent())
                })
        })
        .last()
        .map(|rule| rule.enabled)
        .unwrap_or(true)
}

fn scan(root: &Path, provider: &str, rules: &[SkillRule], result: &mut SkillsResult) {
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(e) if e.kind() == ErrorKind::NotFound => return,
        Err(e) => {
            result
                .warnings
                .push(format!("Could not read {}: {e}", root.display()));
            return;
        }
    };
    let mut pending: Vec<PathBuf> = entries
        .filter_map(|entry| match entry {
            Ok(entry) => Some(entry.path()),
            Err(e) => {
                result.warnings.push(e.to_string());
                None
            }
        })
        .collect();
    let mut visited = HashSet::new();
    while let Some(dir) = pending.pop() {
        if dir
            .file_name()
            .is_some_and(|name| name.to_string_lossy().starts_with('.'))
            || !dir.is_dir()
        {
            continue;
        }
        let Ok(canonical) = fs::canonicalize(&dir) else {
            continue;
        };
        if !visited.insert(canonical.clone()) {
            continue;
        }
        let path = canonical.join("SKILL.md");
        match read_optional(&path) {
            Ok(Some(text)) => match metadata(&text) {
                Ok(meta) => {
                    let skill = UserSkill {
                        name: meta
                            .name
                            .filter(|name| !name.trim().is_empty())
                            .unwrap_or_else(|| {
                                dir.file_name().unwrap().to_string_lossy().into_owned()
                            }),
                        description: meta.description.unwrap_or_default(),
                        provider: provider.into(),
                        path: path.to_string_lossy().into_owned(),
                    };
                    if enabled(&skill, rules) {
                        result.skills.push(skill);
                    }
                }
                Err(e) => result
                    .warnings
                    .push(format!("Could not parse {}: {e}", path.display())),
            },
            Ok(None) => match fs::read_dir(&dir) {
                Ok(entries) => {
                    pending.extend(entries.filter_map(Result::ok).map(|entry| entry.path()))
                }
                Err(e) => result
                    .warnings
                    .push(format!("Could not read {}: {e}", dir.display())),
            },
            Err(e) => result.warnings.push(e),
        }
    }
}

pub fn discover(home: &Path, claude_home: &Path, codex_home: &Path) -> SkillsResult {
    let mut result = SkillsResult::default();
    scan(&claude_home.join("skills"), "Claude Code", &[], &mut result);
    let config_path = codex_home.join("config.toml");
    let config = read_optional(&config_path).and_then(|text| {
        text.map(|text| {
            toml::from_str::<Config>(&text)
                .map_err(|e| format!("Could not parse {}: {}", config_path.display(), e.message()))
        })
        .unwrap_or_else(|| Ok(Config::default()))
    });
    match config {
        Ok(config) => {
            scan(
                &home.join(".agents/skills"),
                "Codex",
                &config.skills.config,
                &mut result,
            );
            scan(
                &codex_home.join("skills"),
                "Codex",
                &config.skills.config,
                &mut result,
            );
        }
        Err(e) => result.warnings.push(e),
    }
    result.skills.sort_by(|a, b| {
        (&a.provider, a.name.to_lowercase(), &a.path).cmp(&(
            &b.provider,
            b.name.to_lowercase(),
            &b.path,
        ))
    });
    let mut seen = HashSet::new();
    result
        .skills
        .retain(|skill| seen.insert((skill.provider.clone(), skill.path.clone())));
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("tailor-skills-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
        fn write(&self, path: &str, text: &str) {
            let path = self.0.join(path);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, text).unwrap();
        }
        fn discover(&self) -> SkillsResult {
            discover(&self.0, &self.0.join(".claude"), &self.0.join(".codex"))
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.0).unwrap();
        }
    }

    #[test]
    fn missing_directories_are_empty_without_creating_them() {
        let fixture = Fixture::new();
        let result = fixture.discover();
        assert!(result.skills.is_empty());
        assert!(result.warnings.is_empty());
        assert_eq!(fs::read_dir(&fixture.0).unwrap().count(), 0);
    }

    #[test]
    fn discovers_personal_skills_and_parses_yaml_without_reading_projects() {
        let fixture = Fixture::new();
        fixture.write(
            ".claude/skills/review/SKILL.md",
            "---\nname: 'Review: code'\ndescription: >-\n  Review code\n  carefully.\n---\nBody",
        );
        fixture.write(
            ".agents/skills/deploy/SKILL.md",
            "---\nname: deploy\ndescription: Deploy code\n---\n",
        );
        fixture.write(".codex/skills/legacy/SKILL.md", "Legacy instructions");
        fixture.write("project/.claude/skills/hidden/SKILL.md", "Not a user skill");
        fixture.write(
            ".codex/skills/.system/internal/SKILL.md",
            "Not a user skill",
        );
        let result = fixture.discover();
        assert!(result.warnings.is_empty());
        assert_eq!(result.skills.len(), 3);
        assert_eq!(result.skills[0].name, "Review: code");
        assert_eq!(result.skills[0].description, "Review code carefully.");
        assert_eq!(result.skills[2].name, "legacy");
    }

    #[test]
    fn filters_disabled_skills_and_respects_last_matching_rule() {
        let fixture = Fixture::new();
        fixture.write(".agents/skills/disabled/SKILL.md", "Disabled");
        fixture.write(".codex/skills/enabled/SKILL.md", "Enabled");
        let disabled = fixture.0.join(".agents/skills/disabled/SKILL.md");
        fixture.write(".codex/config.toml", &format!("[[skills.config]]\npath = '{}'\nenabled = false\n[[skills.config]]\nname = 'enabled'\nenabled = false\n[[skills.config]]\nname = 'enabled'\nenabled = true\n", disabled.display()));
        let result = fixture.discover();
        assert!(result.warnings.is_empty());
        assert_eq!(result.skills.len(), 1);
        assert_eq!(result.skills[0].name, "enabled");
    }

    #[test]
    fn reports_invalid_metadata_and_config_without_claiming_skills_are_enabled() {
        let fixture = Fixture::new();
        fixture.write(".claude/skills/bad/SKILL.md", "---\nname: [invalid\n---");
        fixture.write(".claude/skills/good/SKILL.md", "Good");
        fixture.write(".codex/skills/unknown/SKILL.md", "Unknown");
        fixture.write(".codex/config.toml", "invalid = [");
        let result = fixture.discover();
        assert_eq!(result.skills.len(), 1);
        assert_eq!(result.skills[0].name, "good");
        assert_eq!(result.warnings.len(), 2);
    }

    #[test]
    fn respects_custom_provider_homes() {
        let fixture = Fixture::new();
        fixture.write("custom-claude/skills/a/SKILL.md", "A");
        fixture.write("custom-codex/skills/b/SKILL.md", "B");
        fixture.write(".codex/skills/excluded/SKILL.md", "Excluded");
        let result = discover(
            &fixture.0,
            &fixture.0.join("custom-claude"),
            &fixture.0.join("custom-codex"),
        );
        assert_eq!(result.skills.len(), 2);
    }

    #[cfg(unix)]
    #[test]
    fn follows_symlinks_without_duplicates_or_cycles() {
        use std::os::unix::fs::symlink;
        let fixture = Fixture::new();
        fixture.write(".agents/skills/shared/SKILL.md", "Shared");
        fs::create_dir_all(fixture.0.join(".codex/skills")).unwrap();
        symlink(
            fixture.0.join(".agents/skills/shared"),
            fixture.0.join(".codex/skills/alias"),
        )
        .unwrap();
        symlink(
            fixture.0.join(".codex/skills"),
            fixture.0.join(".codex/skills/loop"),
        )
        .unwrap();
        let result = fixture.discover();
        assert_eq!(result.skills.len(), 1);
    }
}
