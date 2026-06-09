"""
Generic CSV-backed data store with thread-safe CRUD operations.

Provides a ``CSVStore`` class that persists records in a single CSV file on
disk.  Each instance owns a ``threading.Lock`` so concurrent readers/writers
within the same process are serialised correctly.

Design decisions
----------------
* **Read-modify-write** — every mutating method reads the whole file, modifies
  the in-memory list, then rewrites the file atomically.  This is safe and
  simple for the expected data volumes (hundreds to low thousands of rows).
* **Missing columns** — records passed to ``insert`` / ``upsert`` may omit
  columns; missing values default to the empty string.
* **Auto-creation** — if the CSV file (or its parent directory) doesn't exist
  it is created automatically with a header row on first access.
"""

from __future__ import annotations

import csv
import os
import threading
from pathlib import Path
from typing import Any


class CSVStore:
    """Thread-safe, file-backed data store that uses a single CSV file.

    Parameters
    ----------
    csv_path:
        Absolute or relative path to the CSV file.  Parent directories are
        created automatically if they don't exist.
    columns:
        Ordered list of column names.  The first ``insert`` will create the
        file with these columns as a header row.
    key_column:
        The column that acts as the primary key.  ``read_by_key``, ``update``,
        ``delete`` and ``upsert`` all operate on this column's value.
    """

    def __init__(self, csv_path: str, columns: list[str], key_column: str) -> None:
        if key_column not in columns:
            raise ValueError(
                f"key_column {key_column!r} is not in columns {columns!r}"
            )

        self.csv_path = csv_path
        self.columns = columns
        self.key_column = key_column
        self._lock = threading.Lock()

        # Ensure directory exists.
        Path(csv_path).parent.mkdir(parents=True, exist_ok=True)

        # Ensure the CSV file exists with a header row.
        self._ensure_file()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def read_all(self) -> list[dict[str, str]]:
        """Return every record in the store as a list of dicts.

        Returns an empty list when the CSV file contains only a header (or is
        empty).
        """
        with self._lock:
            return self._read()

    def read_by_key(self, key_value: str) -> dict[str, str] | None:
        """Return the first record whose key column equals *key_value*.

        Returns ``None`` if no matching record is found.
        """
        with self._lock:
            for row in self._read():
                if row.get(self.key_column) == key_value:
                    return row
            return None

    def query(self, filters: dict[str, str]) -> list[dict[str, str]]:
        """Return records matching **all** *filters* (AND logic).

        Each key in *filters* must be a column name and the corresponding
        value is matched exactly (case-sensitive string comparison).

        Returns an empty list if nothing matches or if *filters* is empty
        (returning all rows in the latter case would be surprising — use
        ``read_all`` instead).
        """
        if not filters:
            return []

        with self._lock:
            rows = self._read()

        return [
            row
            for row in rows
            if all(row.get(col) == val for col, val in filters.items())
        ]

    def insert(self, record: dict[str, str]) -> dict[str, str]:
        """Append a new record to the store and return the normalised row.

        Missing columns are filled with the empty string.  No uniqueness
        check is performed — callers are responsible for avoiding duplicates
        if that matters for their entity.
        """
        normalised = self._normalise(record)
        with self._lock:
            rows = self._read()
            rows.append(normalised)
            self._write(rows)
        return normalised

    def update(self, key_value: str, updates: dict[str, str]) -> dict[str, str] | None:
        """Update fields of the record identified by *key_value*.

        Only the keys present in *updates* are modified; other columns are
        left untouched.  Returns the updated record, or ``None`` if no
        matching record was found.
        """
        with self._lock:
            rows = self._read()
            for row in rows:
                if row.get(self.key_column) == key_value:
                    for col, val in updates.items():
                        if col in self.columns:
                            row[col] = val
                    self._write(rows)
                    return dict(row)
            return None

    def delete(self, key_value: str) -> bool:
        """Remove the record identified by *key_value*.

        Returns ``True`` if a record was removed, ``False`` if not found.
        """
        with self._lock:
            rows = self._read()
            original_len = len(rows)
            rows = [r for r in rows if r.get(self.key_column) != key_value]
            if len(rows) == original_len:
                return False
            self._write(rows)
            return True

    def upsert(self, key_value: str, record: dict[str, str]) -> dict[str, str]:
        """Insert-or-update a record identified by *key_value*.

        If a record with the given key exists, it is updated with *record*'s
        values (like ``update``).  Otherwise a new row is inserted (like
        ``insert``).  Returns the resulting record in both cases.
        """
        normalised = self._normalise(record)
        # Ensure the key column in the normalised record matches the
        # provided key_value so there is no ambiguity.
        normalised[self.key_column] = key_value

        with self._lock:
            rows = self._read()
            for idx, row in enumerate(rows):
                if row.get(self.key_column) == key_value:
                    for col, val in normalised.items():
                        row[col] = val
                    self._write(rows)
                    return dict(rows[idx])

            # Not found → insert.
            rows.append(normalised)
            self._write(rows)
            return normalised

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _ensure_file(self) -> None:
        """Create the CSV file with a header row if it does not exist."""
        if not os.path.exists(self.csv_path):
            with open(self.csv_path, "w", newline="", encoding="utf-8") as fh:
                writer = csv.DictWriter(fh, fieldnames=self.columns)
                writer.writeheader()

    def _read(self) -> list[dict[str, str]]:
        """Read all rows from the CSV file.

        Must be called while ``self._lock`` is held (or from within a
        public method that already holds it).
        """
        if not os.path.exists(self.csv_path):
            return []

        with open(self.csv_path, "r", newline="", encoding="utf-8") as fh:
            reader = csv.DictReader(fh, fieldnames=self.columns)
            # Skip the header row.
            try:
                next(reader)
            except StopIteration:
                return []
            rows: list[dict[str, str]] = []
            for row in reader:
                # DictReader may produce None values for short rows.
                cleaned = {k: (v if v is not None else "") for k, v in row.items()}
                rows.append(cleaned)
            return rows

    def _write(self, rows: list[dict[str, str]]) -> None:
        """Rewrite the entire CSV file with *rows*.

        Must be called while ``self._lock`` is held.
        """
        with open(self.csv_path, "w", newline="", encoding="utf-8") as fh:
            writer = csv.DictWriter(fh, fieldnames=self.columns)
            writer.writeheader()
            for row in rows:
                writer.writerow(row)

    def _normalise(self, record: dict[str, Any]) -> dict[str, str]:
        """Return a new dict with exactly ``self.columns`` keys.

        Values present in *record* are kept (cast to ``str``); missing
        columns default to the empty string.  Extra keys not in
        ``self.columns`` are silently dropped.
        """
        return {col: str(record.get(col, "")) for col in self.columns}
