from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class AppError(Exception):
    code: str
    status_code: int = 400
    detail: str = "Bad request"
    extra: dict[str, Any] | None = None


class NotFoundError(AppError):
    def __init__(self, code: str, detail: str = "Not found"):
        super().__init__(code=code, status_code=404, detail=detail)


class ConflictError(AppError):
    def __init__(self, code: str, detail: str = "Conflict"):
        super().__init__(code=code, status_code=409, detail=detail)


class ForbiddenError(AppError):
    def __init__(self, code: str, detail: str = "Forbidden"):
        super().__init__(code=code, status_code=403, detail=detail)


class UnauthorizedError(AppError):
    def __init__(self, code: str, detail: str = "Unauthorized"):
        super().__init__(code=code, status_code=401, detail=detail)


class BadRequestError(AppError):
    def __init__(self, code: str, detail: str = "Bad Request"):
        super().__init__(code=code, status_code=400, detail=detail)