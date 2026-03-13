import os
import random
import string
import subprocess
import tarfile
import tempfile
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
INSTALLER = REPO_ROOT / "install.sh"


def _sha256(path: Path) -> str:
    import hashlib
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()


def _make_min_tarball(root: Path) -> Path:
    src = root / "src"
    (src / "dummy").mkdir(parents=True)
    (src / "dummy" / "file.txt").write_text("ok", encoding="utf-8")
    tar_path = root / "claude-lead-system.tar.gz"
    with tarfile.open(tar_path, "w:gz") as tf:
        tf.add(src, arcname="claude-lead-system")
    return tar_path


def _run_verify_only(args, env=None):
    cmd = ["bash", str(INSTALLER), "--verify-only", *args]
    return subprocess.run(
        cmd,
        cwd=str(REPO_ROOT),
        env=env or os.environ.copy(),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


def _run_installer(args, env=None):
    cmd = ["bash", str(INSTALLER), *args]
    return subprocess.run(
        cmd,
        cwd=str(REPO_ROOT),
        env=env or os.environ.copy(),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


def test_installer_verify_only_accepts_valid_checksum_entries():
    with tempfile.TemporaryDirectory(prefix="installer-fuzz-") as td:
        root = Path(td)
        tarball = _make_min_tarball(root)
        checksums = root / "checksums.txt"
        checksums.write_text(
            f"{_sha256(INSTALLER)}  install.sh\n{_sha256(tarball)}  {tarball.name}\n",
            encoding="utf-8",
        )
        res = _run_verify_only([
            "--allow-unsigned-release",
            "--source-tarball", str(tarball),
            "--checksum-file", str(checksums),
        ])
        assert res.returncode == 0, res.stderr


def test_installer_verify_only_rejects_checksum_mismatch():
    with tempfile.TemporaryDirectory(prefix="installer-fuzz-") as td:
        root = Path(td)
        tarball = _make_min_tarball(root)
        checksums = root / "checksums.txt"
        checksums.write_text(
            f"{_sha256(INSTALLER)}  install.sh\n{'0'*64}  {tarball.name}\n",
            encoding="utf-8",
        )
        res = _run_verify_only([
            "--allow-unsigned-release",
            "--source-tarball", str(tarball),
            "--checksum-file", str(checksums),
        ])
        assert res.returncode != 0
        assert "checksum mismatch" in (res.stderr + res.stdout).lower()


def test_installer_arg_parser_fuzz_unknown_flags_fail_cleanly():
    random.seed(7)
    for _ in range(25):
        noise = "".join(random.choice(string.ascii_lowercase) for _ in range(8))
        res = _run_verify_only([f"--{noise}"])
        assert res.returncode != 0
        assert "Unknown argument" in (res.stderr + res.stdout)


def test_release_mode_requires_verified_source_tarball_by_default():
    with tempfile.TemporaryDirectory(prefix="installer-fuzz-") as td:
        root = Path(td)
        checksums = root / "checksums.txt"
        sig = root / "checksums.txt.sig"
        cert = root / "checksums.txt.pem"
        checksums.write_text("deadbeef  install.sh\n", encoding="utf-8")
        sig.write_text("dummy-signature", encoding="utf-8")
        cert.write_text("dummy-cert", encoding="utf-8")
        res = _run_verify_only([
            "--version", "v1.2.3",
            "--checksum-file", str(checksums),
            "--checksum-signature", str(sig),
            "--checksum-cert", str(cert),
        ])
        assert res.returncode != 0
        assert "--source-tarball" in (res.stderr + res.stdout)


def test_release_mode_requires_manifest_bundle_by_default():
    with tempfile.TemporaryDirectory(prefix="installer-fuzz-") as td:
        root = Path(td)
        tarball = _make_min_tarball(root)
        checksums = root / "checksums.txt"
        sig = root / "checksums.txt.sig"
        cert = root / "checksums.txt.pem"
        checksums.write_text(
            f"{_sha256(INSTALLER)}  install.sh\n{_sha256(tarball)}  {tarball.name}\n",
            encoding="utf-8",
        )
        sig.write_text("dummy-signature", encoding="utf-8")
        cert.write_text("dummy-cert", encoding="utf-8")
        res = _run_verify_only([
            "--version", "v1.2.3",
            "--source-tarball", str(tarball),
            "--checksum-file", str(checksums),
            "--checksum-signature", str(sig),
            "--checksum-cert", str(cert),
        ])
        assert res.returncode != 0
        assert "--release-manifest" in (res.stderr + res.stdout)


def test_skip_attestation_does_not_bypass_signed_release_contract():
    with tempfile.TemporaryDirectory(prefix="installer-fuzz-") as td:
        root = Path(td)
        tarball = _make_min_tarball(root)
        checksums = root / "checksums.txt"
        sig = root / "checksums.txt.sig"
        cert = root / "checksums.txt.pem"
        checksums.write_text(
            f"{_sha256(INSTALLER)}  install.sh\n{_sha256(tarball)}  {tarball.name}\n",
            encoding="utf-8",
        )
        sig.write_text("dummy-signature", encoding="utf-8")
        cert.write_text("dummy-cert", encoding="utf-8")
        res = _run_verify_only([
            "--version", "v1.2.3",
            "--skip-attestation-verify",
            "--source-tarball", str(tarball),
            "--checksum-file", str(checksums),
            "--checksum-signature", str(sig),
            "--checksum-cert", str(cert),
        ])
        assert res.returncode != 0
        assert "--release-manifest" in (res.stderr + res.stdout)


def test_ref_mode_requires_explicit_unsigned_opt_out():
    res = _run_verify_only(["--ref", "main"])
    assert res.returncode != 0
    assert "--allow-unsigned-release" in (res.stderr + res.stdout)


def test_ref_mode_allows_dev_install_with_explicit_opt_out():
    res = _run_verify_only(["--ref", "main", "--allow-unsigned-release"])
    assert res.returncode == 0, res.stderr


def test_release_mode_with_valid_signed_assets_passes():
    with tempfile.TemporaryDirectory(prefix="installer-fuzz-") as td:
        root = Path(td)
        tarball = _make_min_tarball(root)
        manifest = root / "release.json"
        manifest.write_text(
            '{"artifacts":{"tarball":{"sha256":"%s"}}}\n' % _sha256(tarball),
            encoding="utf-8",
        )
        checksums = root / "checksums.txt"
        checksums.write_text(
            "\n".join([
                f"{_sha256(INSTALLER)}  install.sh",
                f"{_sha256(tarball)}  {tarball.name}",
                f"{_sha256(manifest)}  {manifest.name}",
            ]) + "\n",
            encoding="utf-8",
        )
        sig = root / "checksums.txt.sig"
        cert = root / "checksums.txt.pem"
        manifest_sig = root / "release.json.sig"
        manifest_cert = root / "release.json.pem"
        sig.write_text("dummy-signature", encoding="utf-8")
        cert.write_text("dummy-cert", encoding="utf-8")
        manifest_sig.write_text("dummy-manifest-signature", encoding="utf-8")
        manifest_cert.write_text("dummy-manifest-cert", encoding="utf-8")

        fake_bin = root / "bin"
        fake_bin.mkdir(parents=True, exist_ok=True)
        cosign = fake_bin / "cosign"
        gh = fake_bin / "gh"
        cosign.write_text(
            "#!/usr/bin/env bash\nset -euo pipefail\n"
            "if [ \"${1:-}\" = \"verify-blob\" ]; then exit 0; fi\n"
            "echo \"unsupported cosign command\" >&2\nexit 1\n",
            encoding="utf-8",
        )
        gh.write_text(
            "#!/usr/bin/env bash\nset -euo pipefail\n"
            "if [ \"${1:-}\" = \"attestation\" ] && [ \"${2:-}\" = \"verify\" ]; then exit 0; fi\n"
            "echo \"unsupported gh command\" >&2\nexit 1\n",
            encoding="utf-8",
        )
        cosign.chmod(0o755)
        gh.chmod(0o755)

        env = os.environ.copy()
        env["PATH"] = str(fake_bin) + os.pathsep + env.get("PATH", "")
        res = _run_verify_only([
            "--version", "v1.2.3",
            "--source-tarball", str(tarball),
            "--checksum-file", str(checksums),
            "--checksum-signature", str(sig),
            "--checksum-cert", str(cert),
            "--release-manifest", str(manifest),
            "--release-manifest-signature", str(manifest_sig),
            "--release-manifest-cert", str(manifest_cert),
            "--slsa-repo", "DrewDawson2027/claude-lead-system",
        ], env=env)
        assert res.returncode == 0, res.stderr


def test_installer_rejects_node_below_18():
    with tempfile.TemporaryDirectory(prefix="installer-fuzz-") as td:
        root = Path(td)
        tarball = _make_min_tarball(root)
        checksums = root / "checksums.txt"
        checksums.write_text(
            f"{_sha256(INSTALLER)}  install.sh\n{_sha256(tarball)}  {tarball.name}\n",
            encoding="utf-8",
        )

        fake_bin = root / "bin"
        fake_bin.mkdir(parents=True, exist_ok=True)
        node = fake_bin / "node"
        node.write_text(
            "#!/usr/bin/env bash\nset -euo pipefail\n"
            "if [ \"${1:-}\" = \"--version\" ]; then\n"
            "  echo \"v16.20.2\"\n"
            "  exit 0\n"
            "fi\n"
            "echo \"stubbed node: unsupported invocation\" >&2\n"
            "exit 1\n",
            encoding="utf-8",
        )
        node.chmod(0o755)

        env = os.environ.copy()
        env["PATH"] = str(fake_bin) + os.pathsep + env.get("PATH", "")
        res = _run_installer([
            "--allow-unsigned-release",
            "--source-tarball", str(tarball),
            "--checksum-file", str(checksums),
        ], env=env)
        assert res.returncode != 0
        assert "require >=18" in (res.stderr + res.stdout)
