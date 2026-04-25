from fastapi import Header, HTTPException, status

ALLOWED_VERIFY_ROLES = {"admin", "verifier"}

def require_verifier_role(x_role: str | None = Header(default=None)) -> None:
    if x_role is None or x_role.lower() not in ALLOWED_VERIFY_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to verify claims",
        )