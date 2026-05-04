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
    def __init__(
        self,
        code: str,
        detail: str = "Not found",
        extra: dict[str, Any] | list | None = None,
    ):
        super().__init__(
            code=code, status_code=404, detail=detail, extra=extra
        )


class ConflictError(AppError):
    def __init__(
        self,
        code: str,
        detail: str = "Conflict",
        extra: dict[str, Any] | list | None = None,
    ):
        super().__init__(
            code=code, status_code=409, detail=detail, extra=extra
        )


class ForbiddenError(AppError):
    def __init__(
        self,
        code: str,
        detail: str = "Forbidden",
        extra: dict[str, Any] | list | None = None,
    ):
        super().__init__(
            code=code, status_code=403, detail=detail, extra=extra
        )


class UnauthorizedError(AppError):
    def __init__(
        self,
        code: str,
        detail: str = "Unauthorized",
        extra: dict[str, Any] | list | None = None,
    ):
        super().__init__(
            code=code, status_code=401, detail=detail, extra=extra
        )


class BadRequestError(AppError):
    def __init__(
        self,
        code: str,
        detail: str = "Bad Request",
        extra: dict[str, Any] | list | None = None,
    ):
        # ``extra`` is forwarded into the ErrorResponse envelope's
        # ``detail`` field — useful for surfacing structured Pydantic
        # validation errors from a route that re-parses stored data
        # at submit time (e.g. the halal-claim questionnaire gate).
        super().__init__(
            code=code, status_code=400, detail=detail, extra=extra
        )