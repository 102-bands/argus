"""Disk LRU on the Railway volume plus a small RAM LRU (PRD §10.1)."""
import os
import threading
from collections import OrderedDict
from pathlib import Path

EVICT_EVERY = 50


class RamLRU:
    def __init__(self, max_bytes: int):
        self.max_bytes = max_bytes
        self._d: OrderedDict[str, bytes] = OrderedDict()
        self._size = 0
        self._lock = threading.Lock()

    def get(self, key: str) -> bytes | None:
        with self._lock:
            v = self._d.get(key)
            if v is not None:
                self._d.move_to_end(key)
            return v

    def put(self, key: str, value: bytes) -> None:
        if len(value) > self.max_bytes // 4:
            return
        with self._lock:
            old = self._d.pop(key, None)
            if old is not None:
                self._size -= len(old)
            self._d[key] = value
            self._size += len(value)
            while self._size > self.max_bytes and self._d:
                _, v = self._d.popitem(last=False)
                self._size -= len(v)


class DiskCache:
    """Files named by content key under root/<namespace>/<key[:2]>/<key>.

    Access time is tracked with mtime (touched on read). Pinned keys live under root/pinned and are never evicted.
    """

    def __init__(self, root: Path, max_bytes: int, ram: RamLRU | None = None):
        self.root = Path(root)
        self.max_bytes = max_bytes
        self.ram = ram
        self._lock = threading.Lock()
        self._puts = 0
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, ns: str, key: str, pinned: bool = False) -> Path:
        base = self.root / "pinned" if pinned else self.root
        return base / ns / key[:2] / key

    def get(self, ns: str, key: str, ram: bool = True) -> bytes | None:
        ram_key = f"{ns}/{key}"
        if ram and self.ram and (v := self.ram.get(ram_key)) is not None:
            return v
        for pinned in (True, False):
            p = self._path(ns, key, pinned)
            try:
                data = p.read_bytes()
            except FileNotFoundError:
                continue
            if not pinned:
                try:
                    os.utime(p)
                except OSError:
                    pass
            if ram and self.ram:
                self.ram.put(ram_key, data)
            return data
        return None

    def put(self, ns: str, key: str, data: bytes, pinned: bool = False, ram: bool = True) -> None:
        p = self._path(ns, key, pinned)
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(f".{threading.get_ident()}.tmp")
        tmp.write_bytes(data)
        os.replace(tmp, p)
        if ram and self.ram:
            self.ram.put(f"{ns}/{key}", data)
        if not pinned:
            # evict() walks the whole cache; with a cutout per exposure that is too often.
            with self._lock:
                self._puts += 1
                due = self._puts % EVICT_EVERY == 0
            if due:
                self.evict()

    def evict(self) -> None:
        with self._lock:
            files = []
            total = 0
            for dirpath, _, names in os.walk(self.root):
                if Path(dirpath).is_relative_to(self.root / "pinned"):
                    continue
                for n in names:
                    fp = Path(dirpath) / n
                    try:
                        st = fp.stat()
                    except FileNotFoundError:
                        continue
                    files.append((st.st_mtime, st.st_size, fp))
                    total += st.st_size
            if total <= self.max_bytes:
                return
            for _, size, fp in sorted(files):
                try:
                    fp.unlink()
                except FileNotFoundError:
                    pass
                total -= size
                if total <= self.max_bytes * 0.9:
                    break
