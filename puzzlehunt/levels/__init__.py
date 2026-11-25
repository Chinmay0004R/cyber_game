import importlib
import pkgutil


def load_levels():
    """Collect every LEVEL dict from level_*.py modules, sorted by id."""
    levels = []
    for _, module_name, _ in pkgutil.iter_modules(__path__):
        if module_name.startswith("level_"):
            mod = importlib.import_module(f"{__name__}.{module_name}")
            if hasattr(mod, "LEVEL"):
                levels.append(mod.LEVEL)
    levels.sort(key=lambda item: item["id"])
    return levels

