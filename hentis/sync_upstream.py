"""Merge stable upstream releases into the feature branch; stop on conflicts."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import urllib.request


def fetch(url, headers=None):
    request = urllib.request.Request(url, headers={"User-Agent": "Hentis-Plane", **(headers or {})})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read(), response.headers


def main():
    current = json.loads(Path("hentis/upstream.json").read_text())
    latest = json.loads(fetch("https://api.github.com/repos/makeplane/plane/releases/latest")[0])
    tag = latest["tag_name"]
    if latest["prerelease"] or latest["draft"] or not re.fullmatch(r"v\d+\.\d+\.\d+", tag):
        raise SystemExit("Release inválida")
    if tag == current["tag"]:
        print("Upstream já atualizado")
        return
    before = tuple(map(int, current["tag"][1:].split(".")))
    after = tuple(map(int, tag[1:].split(".")))
    if after <= before or after[0] != before[0]:
        raise SystemExit("Mudança de major/downgrade exige revisão")
    if re.search(r"breaking|manual intervention|intermediate version|must upgrade|incompatible|migration guide", latest.get("body", ""), re.I):
        raise SystemExit("Notas de upgrade exigem revisão manual")
    image_repo = "makeplane/plane-backend"
    token = json.loads(fetch("https://auth.docker.io/token?service=registry.docker.io&scope=repository:" + image_repo + ":pull")[0])["token"]
    body, headers = fetch("https://registry-1.docker.io/v2/" + image_repo + "/manifests/" + tag, {"Authorization": "Bearer " + token, "Accept": "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json"})
    digest = "sha256:" + hashlib.sha256(body).hexdigest()
    if headers["Docker-Content-Digest"] != digest:
        raise SystemExit("Digest de imagem inconsistente")
    subprocess.run(["git", "fetch", "https://github.com/makeplane/plane.git", "refs/tags/" + tag], check=True)
    commit = subprocess.check_output(["git", "rev-parse", "FETCH_HEAD^{commit}"], text=True).strip()
    subprocess.run(["git", "merge", "--no-edit", "FETCH_HEAD"], check=True)
    Path("hentis/upstream.json").write_text(json.dumps({"tag": tag, "commit": commit, "backend_image": image_repo + ":" + tag + "@" + digest}, indent=2) + "\n")
    subprocess.run(["git", "add", "hentis/upstream.json"], check=True)
    subprocess.run(["git", "commit", "-m", "deploy: track Plane " + tag], check=True)


if __name__ == "__main__":
    main()
