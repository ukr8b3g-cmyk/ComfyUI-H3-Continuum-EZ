import importlib.util
import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('h3ezstudio',ROOT/'__init__.py',submodule_search_locations=[str(ROOT)])
module=importlib.util.module_from_spec(spec);sys.modules['h3ezstudio']=module;spec.loader.exec_module(module)
# pytest treats a hyphenated custom_nodes folder as a standalone __init__.py.
# Map that collector name to the already-loaded package, without editing product code.
sys.modules.setdefault('__init__',module)
