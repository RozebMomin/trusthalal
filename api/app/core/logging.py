import logging
import sys

from app.core.config import settings


def setup_logging() -> None:
    """
    Configure application logging once per process.

    Notes:
    - Uses stdout (container-friendly).
    - Clears existing handlers to avoid duplicate logs when reloaded.
    """
    root = logging.getLogger()

    # Prevent duplicate handlers (common with uvicorn reload)
    if root.handlers:
        root.handlers.clear()

    level_name = (settings.LOG_LEVEL or "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)

    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s %(name)s - %(message)s",
        handlers=[logging.StreamHandler(sys.stdout)],
    )

    # Optional: reduce noisy loggers (tune later)
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)