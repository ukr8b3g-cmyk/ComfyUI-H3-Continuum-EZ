"""Server-owned scratch settings; never part of a workflow or generation identity."""
from __future__ import annotations

from contextlib import contextmanager, nullcontext
from functools import wraps
import json
import mmap
import os
from pathlib import Path
import re
import shutil
import tempfile
import threading
import time
import uuid
import weakref

from . import storage_fs as fs
from .storage_memory import system_memory_bytes


_MANAGER = None
_CACHE_NAME = re.compile(r"^[0-9a-f]{32}\.(npy|tmp)$")
_REMOTE_FS = {"nfs", "nfs4", "cifs", "smbfs", "smb3", "sshfs", "fuse.sshfs", "9p", "afs", "davfs"}
_OWNER_FILE = ".h3-owner.json"


class StorageError(RuntimeError):
    status = 400


class StorageBusy(StorageError):
    status = 409


def install_manager(manager):
    global _MANAGER
    _MANAGER = manager


def get_manager():
    return _MANAGER


def storage_operation(function):
    @wraps(function)
    def wrapped(*args, **kwargs):
        manager = get_manager()
        with manager.operation() if manager else nullcontext():
            return function(*args, **kwargs)
    return wrapped


def _anchor(path):
    path = Path(path)
    while not path.exists() and path != path.parent:
        path = path.parent
    return path


def volumes():
    result = []
    try:
        import psutil
        for part in psutil.disk_partitions(all=False):
            if part.fstype.lower() in _REMOTE_FS or not Path(part.mountpoint).is_dir():
                continue
            try:
                result.append({"path": part.mountpoint, "free_bytes": shutil.disk_usage(part.mountpoint).free,
                               "device": str(Path(part.mountpoint).stat().st_dev)})
            except OSError:
                pass
    except (ImportError, OSError):
        pass
    return result


def _local_path(value):
    if not isinstance(value, str) or len(value) > 4096 or "\0" in value:
        raise StorageError("Enter an absolute folder path on the ComfyUI server")
    value = value.strip()
    if not value:
        return None
    if value.startswith(("\\\\", "//")):
        raise StorageError("Network shares are not supported for scratch storage")
    path = Path(value).expanduser()
    if not path.is_absolute():
        raise StorageError("The scratch folder must be an absolute server path")
    path = path.resolve()
    if os.name == "nt":
        import ctypes
        if ctypes.windll.kernel32.GetDriveTypeW(str(path.anchor)) == 4:
            raise StorageError("Network drives are not supported for scratch storage")
    try:
        import psutil
        matches = [p for p in psutil.disk_partitions(all=True)
                   if path == Path(p.mountpoint) or Path(p.mountpoint) in path.parents]
        if matches and max(matches, key=lambda p: len(p.mountpoint)).fstype.lower() in _REMOTE_FS:
            raise StorageError("Network mounts are not supported for scratch storage")
    except ImportError:
        pass
    return path


def _probe(directory):
    descriptor, name = tempfile.mkstemp(prefix=".h3-probe-", dir=directory)
    try:
        with os.fdopen(descriptor, "w+b") as handle:
            handle.truncate(4096)
            with mmap.mmap(handle.fileno(), 4096, access=mmap.ACCESS_WRITE) as mapping:
                mapping[:4] = b"H3OK"
                mapping.flush()
                if mapping[:4] != b"H3OK":
                    raise StorageError("Scratch mmap verification failed")
            os.fsync(handle.fileno())
        return shutil.disk_usage(directory).free
    finally:
        Path(name).unlink(missing_ok=True)


def _prepare(value):
    parent = _local_path(value)
    if parent is None:
        return {"path": "", "roots": []}
    scratch = parent / "h3-continuum-scratch"
    scratch.mkdir(parents=True, exist_ok=True)
    if scratch.resolve() != scratch:
        raise StorageError("The dedicated scratch directory must not be a link")
    marker = scratch / ".h3-scratch.json"
    with fs.file_lock(scratch / ".settings.lock"):
        if marker.exists():
            payload = fs.read_json(marker)
            if payload.get("schema") != "h3-scratch-root-v1":
                raise StorageError("This scratch directory has unrecognized ownership metadata")
            fs.check_identity(scratch, payload["identity"])
        else:
            if any(p.name != ".settings.lock" for p in scratch.iterdir()):
                raise StorageError("Choose an empty scratch folder; existing unknown files are protected")
            payload = {"schema": "h3-scratch-root-v1", "id": uuid.uuid4().hex,
                       "identity": fs.identity(scratch)}
            fs.atomic_json(marker, payload)
        roots = []
        for kind in ("finalize", "decode"):
            directory = scratch / kind
            directory.mkdir(exist_ok=True)
            if directory.resolve() != directory:
                raise StorageError("A scratch subdirectory must not be a link")
            free = _probe(directory)
            roots.append({"kind": kind, "path": str(directory), "identity": fs.identity(directory),
                          "scratch": str(scratch), "marker": payload["id"], "free_bytes": free})
    return {"path": str(parent), "roots": roots}


def _check_root(record):
    fs.check_identity(record["path"], record["identity"])
    if record.get("scratch"):
        marker = fs.read_json(Path(record["scratch"]) / ".h3-scratch.json")
        if marker.get("schema") != "h3-scratch-root-v1" or marker.get("id") != record["marker"]:
            raise StorageError("Scratch ownership changed")
        fs.check_identity(record["scratch"], marker["identity"])


class StorageSettings:
    def __init__(self, config_file, *, default_finalize, default_decode,
                 busy=lambda: False, queue_guard=nullcontext, read_only=False):
        self.config_file = Path(config_file)
        self.default_finalize = default_finalize
        self.default_decode = default_decode
        self.busy = busy
        self.queue_guard = queue_guard
        self.read_only = read_only
        self._gate = threading.RLock()
        self._active = 0
        self._local = threading.local()
        self._stores = weakref.WeakSet()
        # Disk entries contain only metadata, weak guards/leases, and paths.
        # Retain this ledger after a helper is GC'd, without retaining its tensors.
        self._cache_states = {}
        self._seen = {}
        self._last_backend = None

    def _read(self):
        if not self.config_file.exists():
            return {"schema": 1, "revision": 0, "path": "", "roots": []}
        value = fs.read_json(self.config_file)
        if (value.get("schema") != 1 or type(value.get("revision")) is not int
                or value["revision"] < 0 or not isinstance(value.get("path"), str)
                or not isinstance(value.get("roots"), list)):
            raise StorageError("Invalid scratch settings; restore the server settings file")
        return value

    def _config(self):
        return getattr(self._local, "config", None) or self._read()

    @contextmanager
    def operation(self):
        if getattr(self._local, "config", None) is not None:
            yield
            return
        with self._gate:
            self._local.config = self._read()
            self._active += 1
        try:
            yield
        finally:
            with self._gate:
                self._active -= 1
                del self._local.config

    @contextmanager
    def _maintenance(self):
        if self.read_only:
            error = StorageError("Temporary storage is read-only in multi-user mode")
            error.status = 403
            raise error
        with self._gate, self.queue_guard():
            if self._active or self.busy():
                raise StorageBusy("Wait until the running and pending queues are empty")
            self.config_file.parent.mkdir(parents=True, exist_ok=True)
            with fs.file_lock(self.config_file.with_suffix(".lock")):
                yield

    def validate(self, path):
        with self._maintenance():
            return _prepare(path)

    def save(self, path, revision):
        with self._maintenance():
            old = self._read()
            if type(revision) is not int or revision != old["revision"]:
                raise StorageBusy("Settings changed; refresh before saving")
            prepared = _prepare(path)
            records = {(r["kind"], r["path"]): r for r in self._records(old)}
            records.update({(r["kind"], r["path"]): r for r in prepared["roots"]})
            value = {"schema": 1, "revision": revision + 1, "path": prepared["path"],
                     "roots": list(records.values())}
            fs.atomic_json(self.config_file, value)
            return value

    def resolve(self, kind, default, *, verify=True):
        config = self._config()
        if not config["path"]:
            return Path(default).expanduser().resolve()
        target = str(Path(config["path"]) / "h3-continuum-scratch" / kind)
        record = next((r for r in config["roots"] if r["kind"] == kind and r["path"] == target), None)
        if record is None:
            raise StorageError("Configured scratch storage has no validated directory")
        if verify:
            _check_root(record)
        return Path(target)

    def verify_final_root(self, path):
        config = self._config()
        if config["path"] and str(path) == str(Path(config["path"]) / "h3-continuum-scratch" / "finalize"):
            self.resolve("finalize", path)

    def record_root(self, kind, path):
        path = Path(path).resolve()
        with self._gate:
            key = kind, str(path)
            if key not in self._seen:
                self._seen[key] = {"kind": kind, "path": str(path), "identity": fs.identity(path)}

    def register_store(self, store):
        with self._gate:
            self._stores.add(store)
            self._cache_states[store._scratch_token] = store._cleanup_state

    def record_backend(self, backend, required_bytes, root=None):
        with self._gate:
            self._last_backend = {"backend": backend, "image_bytes": required_bytes,
                                  "path": str(root) if root is not None else None, "at": time.time()}

    def _records(self, config):
        records = {(r["kind"], r["path"]): r for r in config["roots"]}
        for kind, default in (("finalize", self.default_finalize()), ("decode", self.default_decode())):
            path = Path(default).expanduser().resolve()
            key = kind, str(path)
            if key not in records:
                records[key] = {"kind": kind, "path": str(path),
                                "identity": fs.identity(path) if path.exists() else None}
        for key, record in self._seen.items():
            if key not in records or records[key].get("identity") is None:
                records[key] = record
        return list(records.values())

    def _scan(self, cleanup=False):
        from .tools.p20_file_backed_tensor_poc import inspect_managed_files
        config = self._read()
        with self._gate:
            records = self._records(config)
            stores = list(self._stores)
            live_ids = {store._scratch_token for store in stores}
            detached = [state for key, state in self._cache_states.items() if key not in live_ids]
        results = []
        for record in records:
            row = {"kind": record["kind"], "path": record["path"], "bytes": 0,
                   "in_use_bytes": 0, "deletable_bytes": 0, "unknown_bytes": 0,
                   "files": 0, "removed_files": 0, "removed_bytes": 0, "errors": []}
            path = Path(record["path"])
            configured = (str(Path(config["path"]) / "h3-continuum-scratch" / record["kind"])
                          if config["path"] else str(Path(self.default_finalize() if record["kind"] == "finalize"
                                                         else self.default_decode()).expanduser().resolve()))
            row["current"] = record["path"] == configured
            try:
                row["free_bytes"] = shutil.disk_usage(_anchor(path)).free
                row["device"] = str(_anchor(path).stat().st_dev)
                if record.get("identity") is not None:
                    _check_root(record)
                if not path.exists():
                    row["exists"] = False
                    results.append(row)
                    continue
                row["exists"] = True
                cleanup_this = cleanup and record.get("identity") is not None
                if record["kind"] == "finalize":
                    scanned = inspect_managed_files(path, cleanup=cleanup_this)
                else:
                    scanned = inspect_decode_files(path, stores, detached=detached, cleanup=cleanup_this)
                for item in scanned["files"]:
                    row["files"] += 1
                    row["bytes"] += item["bytes"]
                    row[item["state"] + "_bytes"] += item["bytes"]
                row.update({k: scanned[k] for k in ("removed_files", "removed_bytes", "errors")})
            except Exception as exc:
                row["free_bytes"] = None
                row["device"] = None
                row["errors"].append(str(exc))
            results.append(row)
        return results

    def status(self):
        config = self._read()
        available, total = system_memory_bytes()
        return {"revision": config["revision"], "path": config["path"],
                "read_only": self.read_only, "busy": bool(self._active or self.busy()),
                "roots": self._scan(), "volumes": volumes(), "last_backend": self._last_backend,
                "memory": {"available_bytes": available, "total_bytes": total},
                "size_kind": "logical_file_bytes", "at": time.time()}

    def cleanup(self):
        with self._maintenance():
            return {"roots": self._scan(cleanup=True)}


def create_cache_owner(root):
    owner = {"schema": "h3-decode-scratch-v1", "owner": fs.process_owner(),
             "identity": fs.identity(root), "files": []}
    fs.atomic_json(Path(root) / _OWNER_FILE, owner)
    return owner


def register_cache_file(root, owner, name):
    fs.check_identity(root, owner["identity"])
    if not re.fullmatch(r"[0-9a-f]{32}", name):
        raise StorageError("Invalid cache file identity")
    # Register before writing so an interrupted writer leaves attributable files.
    owner["files"] = [name for name in owner["files"] if fs.regular_file(Path(root) / name)]
    owner["files"].extend((name + ".tmp", name + ".npy"))
    fs.atomic_json(Path(root) / _OWNER_FILE, owner)


def remove_empty_cache_root(root, expected):
    root = Path(root)
    try:
        fs.check_identity(root, expected)
        if all(p.name == _OWNER_FILE for p in root.iterdir()):
            (root / _OWNER_FILE).unlink(missing_ok=True)
            root.rmdir()
    except OSError:
        pass


def inspect_decode_files(parent, stores, *, detached=(), cleanup=False):
    result = {"files": [], "removed_files": 0, "removed_bytes": 0, "errors": []}
    managed = {}
    for store in stores:
        managed.update(store.inspect_scratch(cleanup=cleanup, parent=parent))
    for state in detached:
        with state["lock"]:
            for path, entry in list(state["entries"].items()):
                if path.parent.parent != Path(parent):
                    continue
                try:
                    fs.check_identity(path.parent, state["identities"][path.parent])
                    if not fs.regular_file(path):
                        continue
                    live = any(ref() is not None for ref in entry.leases)
                    if cleanup and not live:
                        size = path.stat().st_size
                        path.unlink()
                        state["entries"].pop(path, None)
                        result["removed_files"] += 1
                        result["removed_bytes"] += size
                    else:
                        managed[str(path)] = "in_use" if live else "deletable"
                except (OSError, KeyError):
                    managed[str(path)] = "unknown"
            if cleanup:
                for root, owner in state.get("owners", {}).items():
                    if root.parent != Path(parent):
                        continue
                    try:
                        fs.check_identity(root, owner["identity"])
                        for name in owner["files"]:
                            path = root / name
                            if path not in state["entries"] and fs.regular_file(path):
                                size = path.stat().st_size
                                path.unlink()
                                result["removed_files"] += 1
                                result["removed_bytes"] += size
                    except OSError as exc:
                        result["errors"].append(str(exc))
                for root, expected in state["identities"].items():
                    if root.parent == Path(parent):
                        remove_empty_cache_root(root, expected)
    for root in Path(parent).glob("h3-decode-cache-*"):
        if root.is_symlink() or root.resolve() != root or not root.is_dir():
            continue
        known, dead = set(), False
        try:
            owner = fs.read_json(root / _OWNER_FILE)
            if owner.get("schema") != "h3-decode-scratch-v1":
                raise ValueError("Unknown cache owner")
            fs.check_identity(root, owner["identity"])
            known = {n for n in owner["files"] if isinstance(n, str) and _CACHE_NAME.fullmatch(n)}
            dead = not fs.owner_alive(owner["owner"])
        except (OSError, ValueError, KeyError, TypeError):
            pass
        try:
            children = list(root.iterdir())
        except OSError as exc:
            result["errors"].append(str(exc))
            continue
        for path in children:
            if not _CACHE_NAME.fullmatch(path.name) or not fs.regular_file(path):
                continue
            try:
                size = path.stat().st_size
                state = managed.get(str(path), "deletable" if dead and path.name in known else "unknown")
                if path.name in known and not dead and str(path) not in managed:
                    state = "in_use"
                if cleanup and dead and path.name in known:
                    fs.check_identity(root, owner["identity"])
                    path.unlink()
                    result["removed_files"] += 1
                    result["removed_bytes"] += size
                else:
                    result["files"].append({"bytes": size, "state": state})
            except OSError as exc:
                result["errors"].append(str(exc))
        if cleanup and dead:
            remove_empty_cache_root(root, owner["identity"])
    # Current stores remove entries under their own locks; count those removals.
    for state in managed.values():
        if isinstance(state, dict):
            result["removed_files"] += state["removed_files"]
            result["removed_bytes"] += state["removed_bytes"]
            result["errors"].extend(state.get("errors", []))
    return result
