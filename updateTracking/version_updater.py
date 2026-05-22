#!/usr/bin/env python3

import argparse
import hashlib
import json
import shutil
import sys
import urllib.request
import zipfile
import subprocess
from pathlib import Path


MANIFEST_URLS = [
    "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json",
    "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json",
]

# RENDERCHEST_EXE = Path("/home/taghost/MCDisplayEditorDocker/renderchest/renderchest")
RENDERCHEST_EXE = Path("/home/nyx/Desktop/iconpull/renderchest/renderchest")

ASSET_DIRS_TO_COPY = {
    "blockstates": "assets/minecraft/blockstates",
    "models/block": "assets/minecraft/models/block",
    "models/item": "assets/minecraft/models/item",
    "textures/block": "assets/minecraft/textures/block",
}

SKIP_EXACT_FILES = {
    "beacon.json",
}


def fetch_json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def download_file(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)

    with urllib.request.urlopen(url, timeout=60) as response:
        with dest.open("wb") as f:
            shutil.copyfileobj(response, f)


def sha1_file(path: Path) -> str:
    h = hashlib.sha1()

    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)

    return h.hexdigest()


def load_manifest() -> dict:
    last_error = None

    for url in MANIFEST_URLS:
        try:
            print(f"[manifest] Trying {url}")
            return fetch_json(url)
        except Exception as e:
            last_error = e
            print(f"[manifest] Failed: {e}")

    raise RuntimeError(f"Could not load version manifest. Last error: {last_error}")


def find_version_entry(manifest: dict, version_id: str | None) -> dict:
    if version_id is None:
        version_id = manifest["latest"]["release"]

    for version in manifest["versions"]:
        if version["id"] == version_id:
            return version

    raise RuntimeError(f"Could not find version {version_id} in manifest")


def read_state(state_path: Path) -> dict:
    if not state_path.exists():
        return {}

    return json.loads(state_path.read_text(encoding="utf-8"))


def run_command(command: list[str], cwd: Path) -> None:
    print(f"[run] {' '.join(command)}")
    subprocess.run(command, cwd=cwd, check=True)


def extract_full_assets(jar_path: Path, extracted_dir: Path) -> Path:
    if extracted_dir.exists():
        shutil.rmtree(extracted_dir)

    extracted_dir.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(jar_path, "r") as jar:
        for member in jar.infolist():
            if member.is_dir():
                continue

            if not member.filename.startswith("assets/"):
                continue

            target = extracted_dir / member.filename
            target.parent.mkdir(parents=True, exist_ok=True)

            with jar.open(member, "r") as src, target.open("wb") as dst:
                shutil.copyfileobj(src, dst)

    assets_dir = extracted_dir / "assets"

    if not assets_dir.exists():
        raise RuntimeError(f"Extracted assets folder was not found: {assets_dir}")

    return assets_dir


def should_skip_resource_file(rel: Path) -> bool:
    if rel.name in SKIP_EXACT_FILES:
        return True

    return False


def copy_asset_dirs_to_resources(resources_root: Path, extracted_dir: Path) -> None:
    """
    Copies only NEW files from the downloaded jar into Resources.

    Important:
    - Existing files are never overwritten.
    - beacon.json is skipped so your local bcn workaround stays intact.
    """

    for resource_subdir, jar_subdir in ASSET_DIRS_TO_COPY.items():
        src = extracted_dir / jar_subdir
        dst = resources_root / resource_subdir

        if not src.exists():
            print(f"[warn] Missing extracted asset folder: {src}")
            continue

        dst.mkdir(parents=True, exist_ok=True)

        added = 0
        skipped_existing = 0
        skipped_special = 0

        for file in src.rglob("*"):
            if not file.is_file():
                continue

            rel = file.relative_to(src)

            if should_skip_resource_file(rel):
                skipped_special += 1
                print(f"[skip-special] Resources/{resource_subdir}/{rel}")
                continue

            out = dst / rel

            if out.exists():
                skipped_existing += 1
                continue

            out.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(file, out)
            added += 1

            print(f"[copy-new] Resources/{resource_subdir}/{rel}")

        print(
            f"[copy] Resources/{resource_subdir}: "
            f"added={added}, existing={skipped_existing}, special_skips={skipped_special}"
        )


def clear_dir(path: Path) -> None:
    if path.exists():
        shutil.rmtree(path)

    path.mkdir(parents=True, exist_ok=True)


def run_renderchest(assets_dir: Path, renderchest_output_dir: Path) -> Path:
    clear_dir(renderchest_output_dir)

    run_command(
        [
            str(RENDERCHEST_EXE),
            "--assets", str(assets_dir),
            "--output", str(renderchest_output_dir),
            "--namespace", "minecraft",
            "--size", "32",
            "--quality", "4",
            "--format", "png",
            "--item-list",
        ],
        cwd=RENDERCHEST_EXE.parent
    )

    minecraft_icons_dir = renderchest_output_dir / "items/minecraft"

    if not minecraft_icons_dir.exists():
        raise RuntimeError(
            f"Renderchest completed, but expected output folder was not found: {minecraft_icons_dir}"
        )

    return minecraft_icons_dir


def populate_icon_folder(editor_root: Path, minecraft_icons_dir: Path) -> None:
    icons_dir = editor_root / "Resources" / "iconGenData" / "icons"

    clear_dir(icons_dir)

    count = 0

    for file in minecraft_icons_dir.rglob("*.png"):
        rel = file.relative_to(minecraft_icons_dir)
        dst = icons_dir / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(file, dst)
        count += 1

    print(f"[icons] Rebuilt icon source folder: {icons_dir}")
    print(f"[icons] Copied {count} PNGs")


def run_post_update_scripts(editor_root: Path) -> None:
    scripts_dir = editor_root / "serverScripts"

    run_command(["node", "genBlockList.mjs"], cwd=scripts_dir)
    run_command(["node", "buildBlockAtlas.mjs"], cwd=scripts_dir)
    run_command(["node", "genIconAtlas.mjs"], cwd=scripts_dir)


def write_state(state_path: Path, version_id: str) -> None:
    state_path.parent.mkdir(parents=True, exist_ok=True)

    state_path.write_text(
        json.dumps({"minecraft_version": version_id}, indent=2) + "\n",
        encoding="utf-8"
    )

    print(f"[state] Updated local Minecraft version to {version_id}")


def cleanup_work_dir(work_dir: Path) -> None:
    if work_dir.exists():
        shutil.rmtree(work_dir)

    print(f"[cleanup] Removed work directory: {work_dir}")


def rebuild_docker(editor_root: Path) -> None:
    rebuild_script = editor_root.parent / "rebuild_docker.sh"

    if not rebuild_script.exists():
        print(f"[warn] Docker rebuild script does not exist: {rebuild_script}")
        return

    print("[apply] Rebuilding Docker container")
    run_command(["./rebuild_docker.sh"], cwd=editor_root.parent)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Minecraft version updater for MCDisplayEditor."
    )

    parser.add_argument(
        "--editor-root",
        required=True,
        help="Path to MCDisplayEditor root folder."
    )

    parser.add_argument(
        "--state-file",
        default=None,
        help="Path to local state JSON. Defaults to <editor-root>/updateTracking/state.json."
    )

    parser.add_argument(
        "--version",
        default=None,
        help="Specific Minecraft version to check. Defaults to latest release."
    )

    parser.add_argument(
        "--force-positive",
        action="store_true",
        help="Pretend a new version is available even if state matches."
    )

    parser.add_argument(
        "--work-dir",
        default=None,
        help="Working/download directory. Defaults to <editor-root>/updateTracking/work."
    )

    parser.add_argument(
        "--apply",
        action="store_true",
        help="Actually update resources/icons, run scripts, update state, and rebuild Docker."
    )

    args = parser.parse_args()

    editor_root = Path(args.editor_root).resolve()
    resources_root = editor_root / "Resources"

    state_path = (
        Path(args.state_file).resolve()
        if args.state_file
        else editor_root / "updateTracking" / "state.json"
    )

    work_dir = (
        Path(args.work_dir).resolve()
        if args.work_dir
        else editor_root / "updateTracking" / "work"
    )

    downloads_dir = work_dir / "downloads"
    extracted_dir = work_dir / "extracted"
    renderchest_output_dir = work_dir / "renderchest_output"

    state = read_state(state_path)
    local_version = state.get("minecraft_version")

    manifest = load_manifest()
    version_entry = find_version_entry(manifest, args.version)
    version_id = version_entry["id"]

    if local_version == version_id and not args.force_positive:
        print(f"[ok] Local state already matches checked version: {version_id}")
        return 0

    if local_version == version_id and args.force_positive:
        print(f"[force] Local version matches {version_id}, but forcing update run.")

    print("=" * 80)
    print(f"Local recorded version: {local_version or '(none)'}")
    print(f"Minecraft version found: {version_id}")
    print("=" * 80)

    if not args.apply:
        print("[dry-run] Version difference detected.")
        print("[dry-run] Use --apply to update resources/icons and rebuild Docker.")
        return 0

    version_meta = fetch_json(version_entry["url"])

    client = version_meta.get("downloads", {}).get("client")
    if not client:
        raise RuntimeError(f"No client download found for version {version_id}")

    jar_url = client["url"]
    expected_sha1 = client.get("sha1")

    jar_path = downloads_dir / f"{version_id}-client.jar"

    if jar_path.exists():
        print(f"[download] Reusing existing jar: {jar_path}")
    else:
        print(f"[download] Downloading {version_id} client jar")
        download_file(jar_url, jar_path)

    if expected_sha1:
        actual_sha1 = sha1_file(jar_path)
        if actual_sha1 != expected_sha1:
            raise RuntimeError(
                f"SHA1 mismatch for {jar_path}\n"
                f"Expected: {expected_sha1}\n"
                f"Actual:   {actual_sha1}"
            )
        print("[verify] SHA1 OK")

    print("[extract] Extracting full assets folder")
    assets_dir = extract_full_assets(jar_path, extracted_dir)

    print("[resources] Adding only missing resource files")
    copy_asset_dirs_to_resources(resources_root, extracted_dir)

    print("[renderchest] Generating item icons")
    minecraft_icons_dir = run_renderchest(assets_dir, renderchest_output_dir)

    print("[icons] Moving renderchest minecraft PNGs into Resources/iconGenData/icons")
    populate_icon_folder(editor_root, minecraft_icons_dir)

    print("[scripts] Running block/icon atlas scripts")
    run_post_update_scripts(editor_root)

    write_state(state_path, version_id)

    cleanup_work_dir(work_dir)

    rebuild_docker(editor_root)

    print("[done] Update applied successfully.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("\nInterrupted.")
        raise SystemExit(130)
    except Exception as e:
        print(f"[error] {e}", file=sys.stderr)
        raise SystemExit(1)