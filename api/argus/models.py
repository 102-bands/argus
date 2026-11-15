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


EMAIL = r"^[^@\s<>]{1,64}@[^@\s<>]{1,190}\.[A-Za-z]{2,24}$"


class ContactRequest(BaseModel):
    """Website contact form. `website` is a honeypot: people never see it, bots fill it in."""
    name: str = Field(..., min_length=1, max_length=100)
    email: str = Field(..., max_length=200, pattern=EMAIL)
    topic: Literal["question", "feedback", "bug", "collaboration", "press", "other"] = "question"
    message: str = Field(..., min_length=10, max_length=4000)
    website: str = Field("", max_length=200)

    @field_validator("name", "message")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("must not be blank")
        return v


class CountRequest(BaseModel):
    event: Literal["field", "download", "visit"]
