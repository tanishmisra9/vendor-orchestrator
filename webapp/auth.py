import os
from typing import Final

from fastapi import HTTPException, Request, Response, status

AUTH_COOKIE_NAME: Final[str] = "vendor_orchestrator_auth"


def require_auth_enabled() -> bool:
    return os.getenv("REQUIRE_AUTH", "false").lower() in ("true", "1", "yes")


def get_app_password() -> str:
    return os.getenv("APP_PASSWORD", "")


def is_authenticated(request: Request) -> bool:
    if not require_auth_enabled():
        return True
    return request.cookies.get(AUTH_COOKIE_NAME) == "1"


def set_auth_cookie(response: Response) -> None:
    response.set_cookie(
        AUTH_COOKIE_NAME,
        "1",
        httponly=True,
        secure=False,
        samesite="lax",
        max_age=60 * 60 * 12,
        path="/",
    )


def clear_auth_cookie(response: Response) -> None:
    response.delete_cookie(AUTH_COOKIE_NAME, path="/")


def ensure_authenticated(request: Request) -> None:
    if not is_authenticated(request):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
        )
