"""
FastAPI dependencies for authentication.
"""

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError

from server.auth.security import decode_access_token
from server.db.stores import users_store

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


async def get_current_user(token: str = Depends(oauth2_scheme)) -> dict:
    """FastAPI dependency that extracts and validates the JWT from the
    Authorization header, then returns the full user dict from the database.

    Raises 401 if the token is missing, invalid, expired, or the user
    no longer exists.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired authentication token",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = decode_access_token(token)
        user_id: str = payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    user = users_store.read_by_key(user_id)
    if user is None:
        print(f"401 ERROR! user_id={user_id}, all_users={users_store.read_all()}")
        raise credentials_exception

    return user
