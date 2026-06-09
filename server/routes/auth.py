"""
Authentication routes — registration, login, profile management.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from datetime import datetime
import uuid

from server.auth.dependencies import get_current_user
from server.auth.security import hash_password, verify_password, create_access_token
from server.db.stores import users_store

router = APIRouter()


# --- Request/Response Models ---

class RegisterRequest(BaseModel):
    username: str
    email: str
    password: str


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    user_id: str
    username: str
    email: str
    created_at: str
    last_login: str


class UpdateProfileRequest(BaseModel):
    email: str | None = None
    password: str | None = None
    old_password: str | None = None


# --- Endpoints ---

@router.post("/register", status_code=status.HTTP_201_CREATED, response_model=UserResponse)
async def register(req: RegisterRequest):
    """Register a new user account."""
    # Check for duplicate username
    existing = users_store.query({"username": req.username})
    if existing:
        raise HTTPException(status_code=409, detail="Username already taken")

    # Check for duplicate email
    existing_email = users_store.query({"email": req.email})
    if existing_email:
        raise HTTPException(status_code=409, detail="Email already registered")

    if len(req.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    now = datetime.utcnow().isoformat()
    user_id = str(uuid.uuid4())

    user = users_store.insert({
        "user_id": user_id,
        "username": req.username,
        "email": req.email,
        "password_hash": hash_password(req.password),
        "moodle_token_encrypted": "",
        "sso_username_encrypted": "",
        "sso_password_encrypted": "",
        "sso_student_id_encrypted": "",
        "created_at": now,
        "last_login": now,
        "settings_json": "{}",
    })

    return UserResponse(
        user_id=user["user_id"],
        username=user["username"],
        email=user["email"],
        created_at=user["created_at"],
        last_login=user["last_login"],
    )


@router.post("/login", response_model=TokenResponse)
async def login(req: LoginRequest):
    """Authenticate a user and return a JWT access token."""
    users = users_store.query({"username": req.username})
    if not users:
        raise HTTPException(status_code=401, detail="Invalid username or password")

    user = users[0]
    if not verify_password(req.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid username or password")

    # Update last login
    users_store.update(user["user_id"], {"last_login": datetime.utcnow().isoformat()})

    token = create_access_token({"sub": user["user_id"], "username": user["username"]})
    return TokenResponse(access_token=token)


@router.get("/me", response_model=UserResponse)
async def get_profile(current_user: dict = Depends(get_current_user)):
    """Get the current authenticated user's profile."""
    return UserResponse(
        user_id=current_user["user_id"],
        username=current_user["username"],
        email=current_user["email"],
        created_at=current_user["created_at"],
        last_login=current_user["last_login"],
    )


@router.put("/me", response_model=UserResponse)
async def update_profile(req: UpdateProfileRequest, current_user: dict = Depends(get_current_user)):
    """Update the current user's profile (email, password)."""
    updates = {}

    if req.email is not None:
        # Check email not taken by another user
        existing = users_store.query({"email": req.email})
        if existing and existing[0]["user_id"] != current_user["user_id"]:
            raise HTTPException(status_code=409, detail="Email already in use")
        updates["email"] = req.email

    if req.password is not None:
        if not req.old_password:
            raise HTTPException(status_code=400, detail="Old password is required to change password")
        if not verify_password(req.old_password, current_user["password_hash"]):
            raise HTTPException(status_code=401, detail="Old password is incorrect")
        if len(req.password) < 6:
            raise HTTPException(status_code=400, detail="New password must be at least 6 characters")
        updates["password_hash"] = hash_password(req.password)

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    updated = users_store.update(current_user["user_id"], updates)
    return UserResponse(
        user_id=updated["user_id"],
        username=updated["username"],
        email=updated["email"],
        created_at=updated["created_at"],
        last_login=updated["last_login"],
    )
