import React, { useState, useEffect, useRef, useCallback } from "react";
import { API_BASE } from "../constants";
import { useTaskQueue } from "../context/TaskQueueContext";

export default function CookiePopover() {
  const [cookieOpen, setCookieOpen] = useState(false);
  const [cookieString, setCookieString] = useState("");
  const [cookieSaveStatus, setCookieSaveStatus] = useState("");
  const [cookieStatus, setCookieStatus] = useState(null);
  const btnRef = useRef(null);
  const panelRef = useRef(null);
  const prevRunningRef = useRef(0);

  const { queue } = useTaskQueue();

  const fetchCookieStatus = useCallback(() => {
    fetch(`${API_BASE}/api/pinterest/check_cookie`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setCookieStatus(d); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch(`${API_BASE}/api/pinterest/default_cookie`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.cookie_string) setCookieString(d.cookie_string); })
      .catch(() => {});
  }, []);

  useEffect(() => { fetchCookieStatus(); }, [cookieSaveStatus, fetchCookieStatus]);

  // Re-check cookie status whenever a running task finishes
  useEffect(() => {
    const runningCount = queue.filter(t => t.status === "running").length;
    if (prevRunningRef.current > 0 && runningCount < prevRunningRef.current) {
      fetchCookieStatus();
    }
    prevRunningRef.current = runningCount;
  }, [queue, fetchCookieStatus]);

  useEffect(() => {
    if (!cookieOpen) return;
    const handleClickOutside = (e) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target) &&
        btnRef.current && !btnRef.current.contains(e.target)
      ) {
        setCookieOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [cookieOpen]);

  const savePinterestCookie = async () => {
    try {
      const fd = new FormData();
      fd.append("cookie_string", cookieString);
      const res = await fetch(`${API_BASE}/api/pinterest/save_cookie`, { method: "POST", body: fd });
      if (!res.ok) throw new Error();
      setCookieSaveStatus("saved");
    } catch {
      setCookieSaveStatus("error");
    } finally {
      setTimeout(() => setCookieSaveStatus(""), 2500);
    }
  };

  const expired = cookieStatus && !cookieStatus.valid;
  const noCookie = cookieStatus?.reason === "no_cookie" || cookieStatus?.reason === "empty_cookie";

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setCookieOpen(v => !v)}
        title="Pinterest Cookie"
        className={`px-2.5 py-1.5 rounded-full border text-xs font-medium transition-all flex items-center gap-1.5 ${
          expired
            ? "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
            : noCookie
            ? "border-red-200 bg-red-50 text-red-600 hover:bg-red-100"
            : "border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300"
        }`}
      >
        <span>{expired ? "⚠️" : "🍪"}</span>
        <span className="hidden sm:inline">Cookie</span>
        {cookieStatus && cookieStatus.valid && (
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
        )}
      </button>

      {cookieOpen && (
        <div
          ref={panelRef}
          className="absolute right-6 top-16 z-50 w-80 bg-white rounded-xl shadow-xl border border-gray-200 p-4 flex flex-col gap-3"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-800">Pinterest Cookie</h3>
            <button type="button" onClick={() => setCookieOpen(false)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">&times;</button>
          </div>

          {expired && (
            <div className="text-[0.7rem] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              {cookieStatus.reason === "expired"
                ? "Cookie đã hết hạn hoặc không hợp lệ. Vui lòng cập nhật cookie mới."
                : cookieStatus.reason === "forbidden"
                ? "Cookie bị từ chối (403). Có thể tài khoản bị khóa hoặc cookie sai."
                : cookieStatus.reason === "network_error"
                ? "Không thể kiểm tra cookie (lỗi mạng)."
                : `Lỗi: ${cookieStatus.detail || cookieStatus.reason}`}
            </div>
          )}

          <textarea
            rows={4}
            value={cookieString}
            onChange={e => setCookieString(e.target.value)}
            placeholder="Dán cookie string vào đây (ví dụ: _pinterest_sess=...; _auth=...)"
            className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-pink-300 focus:border-transparent resize-none font-mono"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={savePinterestCookie}
              className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-pink-500 to-rose-500 text-white text-xs font-medium hover:from-pink-600 hover:to-rose-600 transition-all shadow-sm"
            >
              Lưu cookie
            </button>
            {cookieSaveStatus === "saved" && <span className="text-[0.65rem] text-green-600 font-medium">Đã lưu ✓</span>}
            {cookieSaveStatus === "error" && <span className="text-[0.65rem] text-red-500 font-medium">Lỗi lưu</span>}
          </div>
        </div>
      )}
    </>
  );
}
