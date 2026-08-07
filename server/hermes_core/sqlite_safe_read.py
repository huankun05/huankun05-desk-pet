"""Minimal stub of hermes_cli.sqlite_safe_read

Only the symbols hermes_state_search actually uses.
Full implementation in hermes_cli/sqlite_safe_read.py — not needed for state.db.
"""

import sqlite3
from pathlib import Path


class UntrackableConnectionError(RuntimeError):
    pass


class LiveConnectionError(RuntimeError):
    pass


def page_count_bytes(conn) -> int | None:
    """Return the number of pages in the database (from PRAGMA)."""
    try:
        row = conn.execute("PRAGMA page_count").fetchone()
        return row[0] if row else None
    except Exception:
        return None


def file_length_matches_header(path) -> bool | None:
    """Stub: assume OK."""
    return True


def read_header_bytes_preopen(path, *, length: int = 100, force: bool = False) -> bytes | None:
    """Stub: return empty bytes."""
    return None


def offline_file_access(path: Path | str, *, what: str = "read") -> None:
    """Stub: no-op."""
    pass


def has_live_connection(path: Path | str) -> bool:
    """Stub: always False."""
    return False


def track_connection(path: Path | str) -> None:
    pass


def untrack_connection(path: Path | str) -> None:
    pass


def connect_tracked(path: str | Path, *,
                    tracking_path: str | Path | None = None,
                    connect_fn=None,
                    **kwargs) -> sqlite3.Connection:
    """Stub: return a plain sqlite3.Connection (tracking is a no-op)."""
    if connect_fn is None:
        connect_fn = sqlite3.connect
    return connect_fn(str(path), **kwargs)


class TrackedConnection(sqlite3.Connection):
    """Stub: plain sqlite3.Connection."""
    pass
