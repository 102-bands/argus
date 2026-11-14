"""Request and response schemas with the PRD §8.1 bounds."""
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from .config import ALLOWED_COLLECTIONS
from .physics import CoordError, parse_dec, parse_ra

DETECTORS = ("D1", "D2", "D3", "D4", "D5", "D6")
Detector = Literal["D1", "D2", "D3", "D4", "D5", "D6", "all"]
Product = Literal["broadband", "per_detector"]


def validate_collections(v: list[str] | None) -> list[str] | None:
    if v is None:
        return None
    bad = [c for c in v if c not in ALLOWED_COLLECTIONS]
    if bad:
        raise ValueError(f"unknown collections: {bad}")
    return sorted(set(v))


class BlinkRequest(BaseModel):
    ra: float | str
    dec: float | str
    size_arcmin: float = Field(3.0, ge=1.0, le=15.0)
    detectors: list[Detector] = Field(default_factory=lambda: ["all"], max_length=7)
    products: list[Product] = Field(default_factory=lambda: ["broadband", "per_detector"], max_length=2)
    collections: list[str] | None = Field(None, max_length=4)

    @field_validator("ra")
    @classmethod
    def _ra(cls, v):
        try:
            return parse_ra(v)
        except CoordError as e:
            raise ValueError(str(e)) from e

    @field_validator("dec")
    @classmethod
    def _dec(cls, v):
        try:
            return parse_dec(v)
        except CoordError as e:
            raise ValueError(str(e)) from e

    @field_validator("collections")
    @classmethod
    def _collections(cls, v):
        return validate_collections(v)

    def detector_set(self) -> list[str]:
        if "all" in self.detectors:
            return list(DETECTORS)
        return sorted(set(self.detectors))
