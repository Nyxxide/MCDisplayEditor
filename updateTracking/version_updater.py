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

ASSET_DIRS_TO_COMPARE = {
    "blockstates": "assets/minecraft/blockstates",
    "models/block": "assets/minecraft/models/block",
    "models/item": "assets/minecraft/models/item",
    "textures/block": "assets/minecraft/textures/block",
}

IGNORED_FILE_PARTS = [
    "waxed",
    "wall_head",
    "wall_skull",
    "void",
    "item_frame",
]

IGNORED_EXACT_FILES = {
    "water.json",
    "lava.json",
    "air.json",
    "barrier.json",
    "light.json",
    "bubble_column.json",
    "cave_air.json",
    "moving_piston.json",
    "beacon.json",
    "conduit.png",
    "tripwire.png.mcmeta",
    "cactus_side.png.mcmeta",
    "cactus_top.png.mcmeta"
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


def should_ignore(rel_path: Path) -> bool:
    name = rel_path.name

    if name in IGNORED_EXACT_FILES:
        return True

    as_string = str(rel_path).replace("\\", "/")

    for part in IGNORED_FILE_PARTS:
        if part in as_string:
            return True

    return False


def jar_extract_selected(jar_path: Path, extract_root: Path) -> None:
    if extract_root.exists():
        shutil.rmtree(extract_root)

    extract_root.mkdir(parents=True, exist_ok=True)

    wanted_prefixes = tuple(v + "/" for v in ASSET_DIRS_TO_COMPARE.values())

    with zipfile.ZipFile(jar_path, "r") as jar:
        for member in jar.infolist():
            if member.is_dir():
                continue

            if not member.filename.startswith(wanted_prefixes):
                continue

            target = extract_root / member.filename
            target.parent.mkdir(parents=True, exist_ok=True)

            with jar.open(member, "r") as src, target.open("wb") as dst:
                shutil.copyfileobj(src, dst)


def list_files(root: Path) -> set[Path]:
    if not root.exists():
        return set()

    return {
        p.relative_to(root)
        for p in root.rglob("*")
        if p.is_file()
    }


def compare_dirs(local_root: Path, extracted_root: Path) -> dict[str, list[Path]]:
    results = {}

    for label, jar_subpath in ASSET_DIRS_TO_COMPARE.items():
        local_dir = local_root / label
        extracted_dir = extracted_root / jar_subpath

        local_files = list_files(local_dir)
        extracted_files = list_files(extracted_dir)

        new_files = sorted(
            f for f in extracted_files - local_files
            if not should_ignore(f)
        )

        results[label] = new_files

    return results


def print_results(version_id: str, local_version: str | None, results: dict[str, list[Path]]) -> None:
    print()
    print("=" * 80)
    print(f"Minecraft version checked: {version_id}")
    print(f"Local recorded version:   {local_version or '(none)'}")
    print("=" * 80)

    total = 0

    for label, files in results.items():
        print()
        print(f"[{label}] new files: {len(files)}")

        for f in files:
            print(f"  + {f}")

        total += len(files)

    print()
    print("=" * 80)
    print(f"Total new files detected: {total}")
    print("Dry run only. No files were copied. No Docker rebuild was performed.")
    print("=" * 80)

def copy_new_files(resources_root: Path, extracted_root: Path, results: dict[str, list[Path]]) -> None:
    for label, files in results.items():
        jar_subpath = ASSET_DIRS_TO_COMPARE[label]

        for rel_file in files:
            src = extracted_root / jar_subpath / rel_file
            dst = resources_root / label / rel_file

            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)

            print(f"[copy] {src} -> {dst}")


def run_command(command: list[str], cwd: Path) -> None:
    print(f"[run] {' '.join(command)}")
    subprocess.run(command, cwd=cwd, check=True)


def run_post_update_scripts(editor_root: Path) -> None:
    run_command(["node", "genBlockList.mjs"], cwd=editor_root / "serverScripts")
    run_command(["node", "buildBlockAtlas.mjs"], cwd=editor_root / "serverScripts")


def write_state(state_path: Path, version_id: str) -> None:
    state_path.parent.mkdir(parents=True, exist_ok=True)

    state_path.write_text(
        json.dumps({"minecraft_version": version_id}, indent=2) + "\n",
        encoding="utf-8"
    )

    print(f"[state] Updated local Minecraft version to {version_id}")

def main() -> int:
    parser = argparse.ArgumentParser(
        description="Dry-run Minecraft client jar resource diff for MCDisplayEditor."
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
        help="Actually copy missing files, run generator scripts, and update state."
    )

    args = parser.parse_args()

    editor_root = Path(args.editor_root).resolve()
    resources_root = editor_root / "Resources"

    state_path = Path(args.state_file).resolve() if args.state_file else editor_root / "updateTracking" / "state.json"
    work_dir = Path(args.work_dir).resolve() if args.work_dir else editor_root / "updateTracking" / "work"

    downloads_dir = work_dir / "downloads"
    extracted_dir = work_dir / "extracted"

    state = read_state(state_path)
    local_version = state.get("minecraft_version")

    manifest = load_manifest()
    version_entry = find_version_entry(manifest, args.version)
    version_id = version_entry["id"]

    if local_version == version_id and not args.force_positive:
        print(f"[ok] Local state already matches latest checked version: {version_id}")
        print("[ok] Use --force-positive to run the dry diff anyway.")
        return 0

    if local_version == version_id and args.force_positive:
        print(f"[force] Local version matches {version_id}, but forcing positive dry-run.")

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

    print("[extract] Extracting selected Minecraft asset folders")
    jar_extract_selected(jar_path, extracted_dir)

    print("[diff] Comparing extracted assets against local Resources")
    results = compare_dirs(resources_root, extracted_dir)

    print_results(version_id, local_version, results)

    total_new_files = sum(len(files) for files in results.values())

    if not args.apply:
        print("[dry-run] Use --apply to copy files, run scripts, and update state.")
        return 0

    if total_new_files == 0:
        print("[apply] No new files detected. Nothing to copy.")
    else:
        print("[apply] Copying new files into Resources")
        copy_new_files(resources_root, extracted_dir, results)

    print("[apply] Running post-update scripts")
    run_post_update_scripts(editor_root)

    rebuild_script = editor_root.parent / "rebuild_docker.sh"
    print("[apply] Rebuilding Docker container")
    run_command(["./rebuild-docker.sh"], cwd=editor_root.parent)

    write_state(state_path, version_id)

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