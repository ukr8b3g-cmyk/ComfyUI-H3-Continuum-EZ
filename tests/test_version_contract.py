"""Keep installed metadata and diagnostics on the same package version."""
import re
from pathlib import Path
from h3ezstudio import __version__
from h3ezstudio.version import __version__ as report_version


def test_report_version_matches_package_metadata():
    root = Path(__file__).resolve().parents[1]
    metadata = (root / 'pyproject.toml').read_text(encoding='utf-8')
    version = re.search(r'^version\s*=\s*"([^"]+)"', metadata, re.MULTILINE).group(1)
    assert report_version == __version__ == version
