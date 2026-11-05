"""Verify the shipped manifest and frozen spec; does not import ComfyUI."""
import hashlib,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]

def verify():
    rows=(ROOT/'MANIFEST.sha256').read_text().splitlines();count=0
    for row in rows:
        digest,name=row.split('  ',1);p=ROOT/name
        if not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest()!=digest:raise SystemExit('Hash mismatch: '+name)
        count+=1
    lock=json.loads((ROOT/'docs/SPEC_LOCK.json').read_text())
    assert hashlib.sha256((ROOT/'docs'/lock['spec']).read_bytes()).hexdigest()==lock['sha256']
    print(f'{count} files verified; frozen implementation specification unchanged')
if __name__=='__main__':verify()
