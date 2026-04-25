import { useState, useRef } from "react";
import { API_BASE } from "../constants";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";

function Avatar({ url, email, size = 80 }) {
  const initials = (email || "?")[0].toUpperCase();
  if (url) {
    return (
      <img
        src={`${API_BASE}${url}`}
        alt="avatar"
        style={{ width: size, height: size }}
        className="rounded-full object-cover"
      />
    );
  }
  return (
    <div
      style={{ width: size, height: size, fontSize: size * 0.4 }}
      className="rounded-full bg-gray-200 flex items-center justify-center font-semibold text-gray-600 select-none"
    >
      {initials}
    </div>
  );
}

export default function ProfilePage({ authUser, onClose, onUpdateUser }) {
  const fileInputRef = useRef(null);

  // Avatar state
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  const [avatarPreview, setAvatarPreview] = useState(null);

  // Password state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwLoading, setPwLoading] = useState(false);
  const [pwError, setPwError] = useState("");
  const [pwSuccess, setPwSuccess] = useState("");

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Local preview
    const reader = new FileReader();
    reader.onload = (ev) => setAvatarPreview(ev.target.result);
    reader.readAsDataURL(file);

    setAvatarLoading(true);
    setAvatarError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${API_BASE}/api/auth/upload-avatar`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Upload thất bại");
      // Add cache-busting timestamp
      onUpdateUser({ ...authUser, avatar_url: `${data.avatar_url}?t=${Date.now()}` });
    } catch (err) {
      setAvatarError(err.message);
      setAvatarPreview(null);
    } finally {
      setAvatarLoading(false);
    }
  };

  const handleUpdatePassword = async (e) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) { setPwError("Mật khẩu xác nhận không khớp"); return; }
    if (newPassword.length < 6) { setPwError("Mật khẩu mới phải có ít nhất 6 ký tự"); return; }
    setPwLoading(true);
    setPwError("");
    setPwSuccess("");
    try {
      const res = await fetch(`${API_BASE}/api/auth/update-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Có lỗi xảy ra");
      setPwSuccess(data.message);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setPwError(err.message);
    } finally {
      setPwLoading(false);
    }
  };

  const currentAvatarUrl = avatarPreview
    ? null // preview is shown inline
    : authUser?.avatar_url;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-gray-100 p-6 mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold text-gray-900">Hồ sơ của bạn</h2>
          <Button
            variant="ghost"
            onClick={onClose}
            className="w-8 h-8 px-0 text-gray-400 hover:text-gray-600 rounded-full"
          >
            ✕
          </Button>
        </div>

        {/* Avatar section */}
        <div className="flex flex-col items-center gap-3 pb-6 border-b border-gray-100">
          <div className="relative group cursor-pointer" onClick={() => fileInputRef.current?.click()}>
            {avatarPreview ? (
              <img
                src={avatarPreview}
                alt="preview"
                className="w-20 h-20 rounded-full object-cover"
              />
            ) : (
              <Avatar url={currentAvatarUrl} email={authUser?.email} size={80} />
            )}
            <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <span className="text-white text-xs font-medium">
                {avatarLoading ? "..." : "Thay đổi"}
              </span>
            </div>
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
          <div className="text-center">
            <p className="text-sm font-medium text-gray-800">{authUser?.email}</p>
            <p className="text-xs text-gray-400 mt-0.5">Nhấp vào ảnh để thay đổi</p>
          </div>
          {avatarError && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-1.5 w-full text-center">
              {avatarError}
            </p>
          )}
        </div>

        {/* Change password section */}
        <div className="pt-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Đổi mật khẩu</h3>
          <form onSubmit={handleUpdatePassword} className="flex flex-col gap-3">
            <Input
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Mật khẩu hiện tại"
            />
            <Input
              type="password"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Mật khẩu mới"
            />
            <Input
              type="password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Xác nhận mật khẩu mới"
            />
            {pwError && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-1.5">
                {pwError}
              </p>
            )}
            {pwSuccess && (
              <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-1.5">
                {pwSuccess}
              </p>
            )}
            <Button
              type="submit"
              disabled={pwLoading}
              className="mt-1"
            >
              {pwLoading ? "Đang cập nhật..." : "Cập nhật mật khẩu"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
