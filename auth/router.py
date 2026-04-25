import os
from pathlib import Path
from fastapi import APIRouter, HTTPException, Request, UploadFile, File
from pydantic import BaseModel

from services.supabase_client import get_supabase, new_supabase_client

router = APIRouter()


class LoginBody(BaseModel):
    email: str
    password: str


@router.post("/api/auth/login")
async def login(body: LoginBody):
    try:
        res = get_supabase().auth.sign_in_with_password({"email": body.email, "password": body.password})
        return {
            "access_token": res.session.access_token,
            "user": {"email": res.user.email, "id": str(res.user.id)},
        }
    except Exception:
        raise HTTPException(status_code=401, detail="Email hoặc mật khẩu không đúng")


@router.post("/api/auth/logout")
async def logout():
    return {"message": "Logged out"}


@router.get("/api/auth/me")
async def me(request: Request):
    token = request.headers.get("Authorization", "")[7:]
    user_info = get_supabase().auth.get_user(token)
    u = user_info.user
    return {
        "id": str(u.id),
        "email": u.email,
        "avatar_url": (u.user_metadata or {}).get("avatar_url"),
    }


_ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}

@router.post("/api/auth/upload-avatar")
async def upload_avatar(request: Request, file: UploadFile = File(...)):
    if file.content_type not in _ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="Chỉ chấp nhận file ảnh (jpg, png, webp, gif)")

    token = request.headers.get("Authorization", "")[7:]
    user_info = get_supabase().auth.get_user(token)
    user_id = str(user_info.user.id)

    ext = Path(file.filename).suffix.lower() or ".jpg"
    avatars_dir = Path(__file__).resolve().parent.parent / "history" / "avatars"
    avatars_dir.mkdir(parents=True, exist_ok=True)
    dest = avatars_dir / f"{user_id}{ext}"

    content = await file.read()
    dest.write_bytes(content)

    avatar_url = f"/avatars/{user_id}{ext}"
    return {"avatar_url": avatar_url}


class UpdatePasswordBody(BaseModel):
    current_password: str
    new_password: str


@router.post("/api/auth/update-password")
async def update_password(body: UpdatePasswordBody, request: Request):
    if len(body.new_password) < 6:
        raise HTTPException(status_code=400, detail="Mật khẩu mới phải có ít nhất 6 ký tự")
    token = request.headers.get("Authorization", "")[7:]
    try:
        user_info = get_supabase().auth.get_user(token)
        email = user_info.user.email
        # Re-authenticate to verify current password and get a fresh session
        temp = new_supabase_client()
        temp.auth.sign_in_with_password({"email": email, "password": body.current_password})
        temp.auth.update_user({"password": body.new_password})
        return {"message": "Mật khẩu đã được cập nhật thành công"}
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=400, detail="Mật khẩu hiện tại không đúng")


class ForgotPasswordBody(BaseModel):
    email: str
    redirect_to: str


@router.post("/api/auth/forgot-password")
async def forgot_password(body: ForgotPasswordBody):
    try:
        get_supabase().auth.reset_password_for_email(
            body.email,
            options={"redirect_to": body.redirect_to},
        )
    except Exception:
        pass  # Don't reveal whether the email exists
    return {"message": "Nếu email tồn tại, link đặt lại mật khẩu đã được gửi"}


class ResetPasswordBody(BaseModel):
    access_token: str
    refresh_token: str
    password: str


@router.post("/api/auth/reset-password")
async def reset_password(body: ResetPasswordBody):
    try:
        # Create a fresh client per request to avoid session conflicts
        client = new_supabase_client()
        client.auth.set_session(body.access_token, body.refresh_token)
        client.auth.update_user({"password": body.password})
        return {"message": "Mật khẩu đã được cập nhật thành công"}
    except Exception:
        raise HTTPException(status_code=400, detail="Không thể đặt lại mật khẩu. Link có thể đã hết hạn.")
