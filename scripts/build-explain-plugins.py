"""Build explicit, credential-free host profiles; do not infer OAuth acceptance."""
from pathlib import Path
import json
import shutil
import zipfile
import sys

ROOT = Path(__file__).resolve().parents[1]
COMMON = "skills/explain-teacher/"
PROFILES = {
    "portable": ("explain-teacher", ["plugin.json", "mcp.json", COMMON + "SKILL.md", COMMON + "agents/openai.yaml"]),
    "codex": ("explain-teacher-codex", [".codex-plugin/plugin.json", ".mcp.json", COMMON + "SKILL.md", COMMON + "agents/openai.yaml"]),
    "claude": ("explain-teacher-claude", [".claude-plugin/plugin.json", ".mcp.json"]),
}

def build():
    canonical = ROOT / "plugins/explain-teacher" / COMMON / "SKILL.md"
    workflow = ROOT / "plugins/shared/temporary-workflow.md"
    if "--sync-sources" in sys.argv:
        for source, _ in PROFILES.values():
            skill_dir = ROOT / "plugins" / source / COMMON
            skill_dir.mkdir(parents=True, exist_ok=True)
            if source != "explain-teacher":
                shutil.copyfile(canonical, skill_dir / "SKILL.md")
            (skill_dir / "references").mkdir(exist_ok=True)
            shutil.copyfile(workflow, skill_dir / "references/temporary-workflow.md")
    output = ROOT / "dist/plugins"
    output.mkdir(parents=True, exist_ok=True)
    for profile, (source, allowlist) in PROFILES.items():
        skill_dir = ROOT / "plugins" / source / COMMON
        if (skill_dir / "SKILL.md").read_bytes() != canonical.read_bytes() or (skill_dir / "references/temporary-workflow.md").read_bytes() != workflow.read_bytes():
            raise ValueError("Plugin guidance differs; run build-explain-plugins.py --sync-sources")
        files = {relative: ROOT / "plugins" / source / relative for relative in allowlist}
        if profile == "claude":
            files[COMMON + "SKILL.md"] = canonical
        files[COMMON + "references/temporary-workflow.md"] = workflow
        target = output / source
        target.mkdir(parents=True, exist_ok=True)
        # Remove stale output only inside this explicitly resolved build folder.
        for path in target.rglob("*"):
            if path.is_file() and path.relative_to(target).as_posix() not in files:
                path.unlink()
        for relative, src in files.items():
            dst = target / relative
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(src, dst)
            if relative.endswith(".json"):
                json.loads(dst.read_text(encoding="utf-8"))
        with zipfile.ZipFile(output / (source + ".zip"), "w", zipfile.ZIP_DEFLATED) as archive:
            for relative in sorted(files):
                archive.write(target / relative, relative)
        print(f"Built {profile}: {len(files)} allowlisted files")

if __name__ == "__main__":
    build()
