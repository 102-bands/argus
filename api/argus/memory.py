"""Process memory: report RSS and hand freed memory back to the OS.

Each live job decodes a few hundred FITS cutouts in a pool of threads. With glibc, freed memory from many
threads stays in per-thread arenas, so RSS ratchets up job after job even though nothing leaks: it looks
like memory "accumulating after the user closed the tab". The Dockerfile caps arenas (MALLOC_ARENA_MAX=2);
release() also asks glibc to return free pages after each job and on a timer.
"""
import ctypes
import gc
import sys
from functools import lru_cache


@lru_cache
def _libc():
    if not sys.platform.startswith("linux"):
        return None
    try:
        return ctypes.CDLL("libc.so.6")
    except OSError:
        return None


def rss_mb() -> float | None:
    """Resident memory of this process in MB (Linux /proc; None elsewhere)."""
    try:
        with open("/proc/self/status") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    return round(int(line.split()[1]) / 1024, 1)
    except OSError:
        pass
    return None


def release() -> None:
    gc.collect()
    libc = _libc()
    if libc is not None:
        libc.malloc_trim(0)
