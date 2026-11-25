"""Shared enums and base models used by the request/response schemas."""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, ConfigDict


class StrictModel(BaseModel):
    """Request models reject unknown fields so contract drift fails loudly."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ResponseModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Unit(StrEnum):
    MEALS = "MEALS"
    PACKETS = "PACKETS"
    BOXES = "BOXES"


class DietaryType(StrEnum):
    VEG = "VEG"
    NON_VEG = "NON_VEG"


class DietaryRequirement(StrEnum):
    VEG_ONLY = "VEG_ONLY"
    ANY = "ANY"


class Urgency(StrEnum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class MealPeriod(StrEnum):
    BREAKFAST = "BREAKFAST"
    LUNCH = "LUNCH"
    DINNER = "DINNER"
    ALL_DAY = "ALL_DAY"


class DistanceSource(StrEnum):
    STRAIGHT_LINE_ESTIMATE = "STRAIGHT_LINE_ESTIMATE"
    ROAD_GOOGLE_ROUTES = "ROAD_GOOGLE_ROUTES"


class StorageType(StrEnum):
    ROOM_TEMPERATURE = "ROOM_TEMPERATURE"
    REFRIGERATED = "REFRIGERATED"
    FROZEN = "FROZEN"
    HOT_HELD = "HOT_HELD"


# Identifier used by the backend (UUIDs) or by callers of the optimisers
# (free-form short ids such as "s1"). Kept as constrained strings.
ID_PATTERN = r"^[A-Za-z0-9._:-]{1,64}$"
NAME_MAX = 200
