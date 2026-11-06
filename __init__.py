"""H3 Continuum EZ: optional, explicitly requested local prompt enhancement."""
from .ez_nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS
from .storage_api import register_routes as _register_storage
from .assist_api import register_routes as _register_assist
WEB_DIRECTORY = './web'
__version__ = '0.10.0'
_register_storage()
_register_assist()
__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS', 'WEB_DIRECTORY']
