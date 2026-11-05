"""Small filesystem primitives for Continuum's private scratch storage."""
from __future__ import annotations

from contextlib import contextmanager
import json
import math
import os
from pathlib import Path
import stat
import threading
import uuid


_LOCKS = {}
_LOCKS_GUARD = threading.Lock()
_LOCAL = threading.local()


def identity(path):
    path = Path(path)
    info = path.stat()
    return {"path": str(path.resolve()), "device": info.st_dev, "inode": info.st_ino}


def check_identity(path, expected):
    if identity(path) != expected or str(Path(path).absolute()) != expected["path"]:
        raise OSError("Scratch directory changed or its storage is no longer mounted")


def regular_file(path):
    try:
        info = Path(path).lstat()
        return stat.S_ISREG(info.st_mode) and not (getattr(info, "st_file_attributes", 0) & 0x400)
    except OSError:
        return False


def read_json(path):
    path = Path(path)
    if not regular_file(path) or path.stat().st_size > 1024 * 1024:
        raise OSError("Invalid scratch metadata file")
    with path.open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError("Scratch metadata must be an object")
    return value


def atomic_json(path, value):
    path = Path(path)
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".partial")
    try:
        with temporary.open("x", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


@contextmanager
def file_lock(path):
    """Reentrant thread/process lock. Callers validate the containing directory."""
    path = Path(path)
    key = str(path.absolute())
    with _LOCKS_GUARD:
        lock = _LOCKS.setdefault(key, threading.RLock())
    with lock:
        depths = getattr(_LOCAL, "depths", None)
        if depths is None:
            depths = _LOCAL.depths = {}
        if depths.get(key, 0):
            depths[key] += 1
            try:
                yield
            finally:
                depths[key] -= 1
            return
        if path.is_symlink():
            raise OSError("Scratch lock must not be a symbolic link")
        with path.open("a+b") as handle:
            handle.seek(0, os.SEEK_END)
            if handle.tell() == 0:
                handle.write(b"\0")
                handle.flush()
            handle.seek(0)
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
            else:
                import fcntl
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            depths[key] = 1
            try:
                yield
            finally:
                depths.pop(key, None)
                if os.name == "nt":
                    handle.seek(0)
                    msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def process_owner():
    import psutil
    return {"pid": os.getpid(), "created": psutil.Process().create_time()}


def owner_alive(owner):
    """Unknown ownership is protected, including missing process counters."""
    try:
        import psutil
        pid, created = owner["pid"], owner["created"]
        if (type(pid) is not int or pid <= 0 or type(created) not in (int, float)
                or not math.isfinite(created) or created <= 0):
            return True
        process = psutil.Process(pid)
        return process.is_running() and abs(process.create_time() - created) < 0.01
    except Exception as exc:
        try:
            import psutil
            if isinstance(exc, psutil.NoSuchProcess):
                return False
        except ImportError:
            pass
        return True
