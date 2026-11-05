"""EZ adapter around Continuum's unchanged managed file-backed buffers."""
from pathlib import Path
import tempfile
import torch
from .vendor.continuum import storage_settings
from .vendor.continuum.v3 import file_backed_buffer as buffers


def backing_root():
    manager = storage_settings.get_manager()
    if manager:
        return manager.resolve('finalize', manager.default_finalize())
    try:
        import folder_paths
        base = folder_paths.get_temp_directory()
    except (ImportError, AttributeError):
        base = tempfile.gettempdir()
    return Path(base) / 'h3-continuum-ez-file-backed'


def select_backend(requested, required_bytes):
    buffers.validate_buffer_backend(requested)
    root = backing_root()
    if requested == 'Auto':
        requested = buffers.select_auto_buffer_backend(required_bytes, backing_root=root).selected_backend
    buffers.preflight_manual_buffer(requested, required_bytes, backing_root=root)
    manager = storage_settings.get_manager()
    if manager:
        manager.record_backend(requested, required_bytes, root if requested == 'Disk-backed' else None)
    return requested


def allocate(stack, shape, dtype):
    required = torch.empty((), dtype=dtype).element_size()
    for n in shape:
        required *= n
    root = backing_root()
    buffers.preflight_manual_buffer('Disk-backed', required, backing_root=root)
    return stack.enter_context(buffers.allocate_file_backed_image(tuple(shape), dtype=dtype, backing_root=root))


def spill(tensor):
    """Copy one CPU latent to tracked backing; aliases keep its file alive."""
    root = backing_root()
    buffers.preflight_manual_buffer('Disk-backed', tensor.numel()*tensor.element_size(), backing_root=root)
    with buffers.allocate_file_backed_image(tuple(tensor.shape), dtype=tensor.dtype, backing_root=root) as allocation:
        allocation.tensor.copy_(tensor)
        return allocation.publish()


def collect():
    buffers.get_file_backed_image_manager(backing_root()).collect_ready()
