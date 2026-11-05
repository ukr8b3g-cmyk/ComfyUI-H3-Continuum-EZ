"""H3 Continuum EZ Studio 0.9.0. No network, filesystem writes or core patches at import."""
from .ez_nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS
WEB_DIRECTORY = './web'
__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS', 'WEB_DIRECTORY']

from .storage_api import register_routes
register_routes()
