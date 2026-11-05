"""Available CPU memory, bounded by applicable Linux cgroup limits when known."""
from pathlib import Path


def _cgroup_limits(proc=Path("/proc/self/cgroup"), mounts=Path("/proc/self/mountinfo")):
    groups = []
    for line in proc.read_text().splitlines():
        _, controllers, relative = line.split(":", 2)
        if controllers == "" or "memory" in controllers.split(","):
            groups.append((controllers == "", relative))
    for line in mounts.read_text().splitlines():
        before, after = line.split(" - ", 1)
        fields, filesystem = before.split(), after.split()
        for v2, relative in groups:
            if (v2 and filesystem[0] != "cgroup2") or (not v2 and (filesystem[0] != "cgroup" or "memory" not in filesystem[-1].split(","))):
                continue
            mount = Path(fields[4].replace("\\040", " "))
            root = fields[3]
            if root != "/" and (relative == root or relative.startswith(root.rstrip("/") + "/")):
                relative = relative[len(root):]
            current = mount / relative.lstrip("/")
            # A private cgroup namespace can expose its group at the mount root.
            if not current.exists():
                current = mount
            while current == mount or mount in current.parents:
                limit_name, used_name = (("memory.max", "memory.current") if v2 else
                                         ("memory.limit_in_bytes", "memory.usage_in_bytes"))
                try:
                    limit = int((current / limit_name).read_text().strip())
                    used = int((current / used_name).read_text().strip())
                    if 0 < limit < 2**60 and used >= 0:
                        yield max(0, limit - used), limit
                except (OSError, ValueError):
                    pass
                if current == mount:
                    break
                current = current.parent


def system_memory_bytes():
    try:
        import psutil
        counters = psutil.virtual_memory()
        available, total = int(counters.available), int(counters.total)
    except Exception:
        return None, None
    try:
        for remaining, limit in _cgroup_limits():
            available, total = min(available, remaining), min(total, limit)
    except (OSError, ValueError):
        pass
    return available, total
