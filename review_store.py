"""Durable review state. A manifest commit is the only way to adopt a part."""
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
from uuid import uuid4


class ReviewError(ValueError):
    pass


def token(value):
    if not isinstance(value, str) or re.fullmatch(r'[0-9a-f]{32}', value) is None:
        raise ReviewError('Invalid review identifier')
    return value


def sha_file(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def _publish(path, write):
    temp = path.with_name(f'.{uuid4().hex}.partial')
    try:
        write(temp)
        with temp.open('r+b') as file:
            os.fsync(file.fileno())
        os.replace(temp, path)
        if hasattr(os, 'O_DIRECTORY'):
            fd = os.open(path.parent, os.O_DIRECTORY)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
    finally:
        temp.unlink(missing_ok=True)


class ReviewStore:
    def __init__(self, output_root, run, binding):
        self.run, self.binding = token(run), token(binding)
        output_root = Path(output_root).resolve()
        self.folder = output_root / 'h3_continuum_ez' / 'runs' / self.run
        if self.folder.resolve() != self.folder:
            raise ReviewError('Invalid review storage directory')
        self.manifest = self.folder / 'manifest.json'
        self.state = None

    @contextmanager
    def writer(self, create=False):
        if create:
            self.folder.mkdir(parents=True, exist_ok=True)
        if not self.folder.is_dir():
            raise ReviewError('Review run was not found')
        path = self.folder / 'writer.lock'
        if path.is_symlink():
            raise ReviewError('Invalid review lock')
        with path.open('a+b') as lock:
            lock.seek(0)
            try:
                if os.name == 'nt':
                    import msvcrt
                    msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError as error:
                raise ReviewError('A review operation is already running') from error
            self.state = self.read(missing=create)
            yield self

    def read(self, missing=False):
        if self.manifest.is_symlink():
            raise ReviewError('Invalid review manifest')
        try:
            data = json.loads(self.manifest.read_text(encoding='utf-8'))
        except FileNotFoundError:
            if missing:
                return None
            raise ReviewError('Review run was not found') from None
        if not isinstance(data, dict) or data.get('schema') != 1:
            raise ReviewError('Unsupported review manifest format')
        if data.get('binding') != self.binding or data.get('run') != self.run:
            raise ReviewError('Review run belongs to another workflow')
        return data

    def status(self):
        data = self.read()
        candidate = data['candidate']
        pending = data['pending']
        return {
            'revision': data['revision'], 'total': data['total'],
            'accepted': len(data['accepted']),
            'accepted_previews': [{k: item.get(k) for k in ('join', 'record')} for item in data['accepted']],
            'candidate': {k: candidate.get(k) for k in ('id', 'preview', 'join', 'record')} if candidate else None,
            'pending': pending['kind'] if pending else None,
            'complete': data.get('complete', False),
        }

    def _commit(self):
        self.state['revision'] += 1
        encoded = json.dumps(self.state, ensure_ascii=False, allow_nan=False).encode()
        _publish(self.manifest, lambda path: path.write_bytes(encoded))

    def begin(self, command, identity, total, seed):
        action = command['action']
        command_id = token(command['command_id'])
        if self.state is None:
            if action != 'next' or command['revision'] != 0 or command['candidate'] is not None:
                raise ReviewError('Review run was not found')
            self.state = {
                'schema': 1, 'run': self.run, 'binding': self.binding,
                'identity': identity, 'total': total, 'seed': str(seed), 'revision': 0,
                'accepted': [], 'candidate': None, 'pending': None, 'complete': False,
                'variation': 0, 'commands': {},
            }
        data = self.state
        saved_identity = data['identity']
        # The initial v0.13.7 GitHub ZIP still reported 0.13.6. Its review data is compatible.
        if saved_identity.get('engine_version') == '0.13.6' and identity.get('engine_version') == '0.13.7':
            saved_identity = {**saved_identity, 'engine_version': '0.13.7'}
        if saved_identity != identity or data['total'] != total:
            raise ReviewError('Generation conditions changed. Restore the inputs or start a new review.')
        if data['seed'] != str(seed):
            raise ReviewError('Seed changed. Restore the original seed or start a new review.')
        if command_id in data['commands']:
            if data['commands'][command_id] != command:
                raise ReviewError('Review command identifier was reused')
            return None
        if command['revision'] != data['revision']:
            raise ReviewError('Review changed. Refresh its status and try again.')
        candidate = data['candidate']
        if command['candidate'] != (candidate['id'] if candidate else None):
            raise ReviewError('The selected candidate changed')
        pending = data['pending']
        if action == 'resume':
            if pending is None:
                raise ReviewError('There is no unfinished review operation')
        elif action == 'preview' and candidate and pending is None:
            data['pending'] = {'kind': 'preview', 'raw': candidate}
        elif action == 'retry' and candidate and pending is None:
            data['variation'] += 1
            data['pending'] = {'kind': 'part', 'id': uuid4().hex, 'raw': None}
        elif action == 'next' and not data['complete'] and (pending is None or (candidate and pending['kind'] == 'part')):
            if candidate:
                self._checked_raw_path(candidate)
                data['accepted'].append(candidate)
                data['candidate'] = None
            data['variation'] = 0
            data['pending'] = ({'kind': 'export'} if len(data['accepted']) == total
                               else {'kind': 'part', 'id': uuid4().hex, 'raw': None})
        else:
            raise ReviewError('This action is unavailable in the current review state')
        data['commands'][command_id] = command
        self._commit()
        return data['pending']['kind']

    def save_raw(self, latent, record):
        from safetensors.torch import save_file
        from .vendor.continuum.state import extract_av_streams
        pending = self.state['pending']
        video, audio = extract_av_streams(latent)
        path = self.folder / f"{token(pending['id'])}.safetensors"
        _publish(path, lambda dest: save_file({'video': video, 'audio': audio}, str(dest)))
        raw = {'id': pending['id'], 'sha256': sha_file(path), 'record': dict(record)}
        raw['record']['seed'] = str(record['seed'])
        pending['raw'] = raw
        self._commit()
        return raw

    def _checked_raw_path(self, raw):
        path = self.folder / f"{token(raw['id'])}.safetensors"
        if path.is_symlink() or not path.is_file() or sha_file(path) != raw['sha256']:
            raise ReviewError('A saved review part is missing or damaged')
        return path

    def load_raw(self, raw):
        from safetensors.torch import load_file
        from .vendor.continuum.v2.sampling import latent_from_cpu
        data = load_file(str(self._checked_raw_path(raw)), device='cpu')
        return latent_from_cpu(data['video'], data['audio'])

    def ready(self, raw, preview, join=None):
        self.state['candidate'] = {**raw, 'preview': preview, 'join': join}
        self.state['pending'] = None
        self._commit()

    def finish(self):
        self.state['pending'] = None
        self.state['complete'] = True
        self._commit()
