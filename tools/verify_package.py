"""Check the installed package inventory and preserved Continuum provenance."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
IGNORED = {'__pycache__', '.pytest_cache', '.git'}

def included(path):
    return path.is_file() and not any(p in IGNORED for p in path.relative_to(ROOT).parts) and path.suffix not in ('.pyc','.pyo')

def verify():
    records={}
    for line in (ROOT/'MANIFEST.sha256').read_text(encoding='utf-8').splitlines():
        expected,name=line.split('  ',1)
        path=ROOT/name
        if name in records or not path.resolve().is_relative_to(ROOT) or path.is_symlink():
            raise SystemExit('Invalid/duplicate manifest member: '+name)
        if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest()!=expected:
            raise SystemExit('Package hash mismatch: '+name)
        records[name]=expected
    actual={p.relative_to(ROOT).as_posix() for p in ROOT.rglob('*') if included(p)}-{'MANIFEST.sha256'}
    if actual != set(records):
        raise SystemExit('Package inventory differs: '+repr(actual ^ set(records)))
    lock=json.loads((ROOT/'docs/SPEC_LOCK.json').read_text(encoding='utf-8'))
    if hashlib.sha256((ROOT/'docs'/lock['spec']).read_bytes()).hexdigest()!=lock['sha256']:
        raise SystemExit('Frozen implementation specification changed')
    core=json.loads((ROOT/'docs/CORE_PROVENANCE.json').read_text(encoding='utf-8'))
    preserved=0
    for item in core['files']:
        if item['mode']=='byte-identical':
            path=ROOT/'vendor/continuum'/item['path']
            if hashlib.sha256(path.read_bytes()).hexdigest()!=item['sha256']:
                raise SystemExit('Core provenance mismatch: '+item['path'])
            preserved+=1
    storage=json.loads((ROOT/'vendor/continuum/STORAGE_PROVENANCE.json').read_text())
    for name,expected in storage['sha256'].items():
        if hashlib.sha256((ROOT/'vendor/continuum'/name).read_bytes()).hexdigest()!=expected:
            raise SystemExit('Storage provenance mismatch: '+name)
        preserved+=1
    seams=json.loads((ROOT/'vendor/continuum/SEAM_PROVENANCE.json').read_text())
    for name,expected in seams['sha256'].items():
        if hashlib.sha256((ROOT/'vendor/continuum'/name).read_bytes()).hexdigest()!=expected:
            raise SystemExit('Seam provenance mismatch: '+name)
        preserved+=1
    print(json.dumps({'package_files':len(records),'preserved_upstream_modules':preserved,'sha256':'PASS','inventory':'PASS'},ensure_ascii=False))

if __name__=='__main__':verify()
