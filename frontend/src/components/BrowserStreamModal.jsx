import { useEffect, useRef, useState, useCallback } from "react";
import { API_BASE } from "../constants";

/**
 * Modal stream Playwright browser từ VPS về canvas.
 * Props:
 *   open       - boolean
 *   mode       - "product" | "keyword"
 *   projectId  - string | null
 *   onCaptured - callback({ mode }) khi API đã bắt được
 *   onClose    - callback khi user đóng modal
 */
export default function BrowserStreamModal({ open, mode = "product", projectId, onCaptured, onClose }) {
  const canvasRef = useRef(null);
  const wsRef = useRef(null);
  const [status, setStatus] = useState("connecting"); // connecting | streaming | captured | error
  const [errorMsg, setErrorMsg] = useState("");

  // Derive WS URL from API_BASE
  const getWsUrl = useCallback(() => {
    const base = API_BASE
      ? API_BASE.replace(/^http/, "ws")
      : `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}`;
    const params = new URLSearchParams({ mode });
    if (projectId) params.set("project_id", projectId);
    return `${base}/ws/henull-browser?${params}`;
  }, [mode, projectId]);

  useEffect(() => {
    if (!open) return;
    setStatus("connecting");
    setErrorMsg("");

    const ws = new WebSocket(getWsUrl());
    wsRef.current = ws;
    ws.binaryType = "arraybuffer";

    ws.onopen = () => setStatus("streaming");

    ws.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) {
        // Screenshot frame
        const blob = new Blob([e.data], { type: "image/jpeg" });
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          const canvas = canvasRef.current;
          if (!canvas) return;
          canvas.getContext("2d").drawImage(img, 0, 0);
          URL.revokeObjectURL(url);
        };
        img.src = url;
      } else {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === "captured") {
            setStatus("captured");
            onCaptured?.({ mode: msg.mode });
          } else if (msg.type === "error") {
            setStatus("error");
            setErrorMsg(msg.message || "Lỗi không xác định");
          }
        } catch (_) {}
      }
    };

    ws.onerror = () => {
      setStatus("error");
      setErrorMsg("Không kết nối được tới server.");
    };

    ws.onclose = () => {
      if (status !== "captured") setStatus("error");
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = useCallback((obj) => {
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify(obj));
  }, []);

  const getCoords = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      x: Math.round((e.clientX - rect.left) * (1280 / rect.width)),
      y: Math.round((e.clientY - rect.top) * (800 / rect.height)),
    };
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="flex flex-col bg-white rounded-xl shadow-2xl overflow-hidden" style={{ width: "min(92vw, 1300px)" }}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-gray-900 text-white">
          <div className="flex items-center gap-2 text-sm font-medium">
            <span className={`w-2 h-2 rounded-full ${
              status === "streaming" ? "bg-green-400 animate-pulse" :
              status === "captured" ? "bg-blue-400" :
              status === "error"    ? "bg-red-400" : "bg-yellow-400 animate-pulse"
            }`} />
            {status === "connecting" && "Đang kết nối..."}
            {status === "streaming" && "Đăng nhập HEnull → vào tool → search keyword"}
            {status === "captured"  && "✅ Đã bắt được API! Đang crawl..."}
            {status === "error"     && `❌ ${errorMsg}`}
          </div>
          <button
            onClick={() => { wsRef.current?.close(); onClose?.(); }}
            className="text-gray-400 hover:text-white transition-colors text-lg leading-none px-1"
          >
            ✕
          </button>
        </div>

        {/* Canvas */}
        <div className="relative bg-gray-100 flex items-center justify-center" style={{ aspectRatio: "1280/800" }}>
          {status === "connecting" && (
            <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">
              Đang khởi động browser...
            </div>
          )}
          {status === "captured" && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-white text-lg font-semibold">
              ✅ Đã bắt được! Đang crawl dữ liệu...
            </div>
          )}
          <canvas
            ref={canvasRef}
            width={1280}
            height={800}
            className="w-full h-full block"
            tabIndex={0}
            style={{ cursor: status === "streaming" ? "default" : "not-allowed" }}
            onMouseMove={(e) => status === "streaming" && send({ type: "mousemove", ...getCoords(e) })}
            onClick={(e) => { if (status !== "streaming") return; e.currentTarget.focus(); send({ type: "click", ...getCoords(e) }); }}
            onContextMenu={(e) => { e.preventDefault(); if (status !== "streaming") return; send({ type: "click", ...getCoords(e), button: "right" }); }}
            onWheel={(e) => status === "streaming" && send({ type: "scroll", deltaX: e.deltaX, deltaY: e.deltaY })}
            onKeyDown={(e) => {
              if (status !== "streaming") return;
              // Ctrl+V → paste
              if (e.ctrlKey && e.key === "v") {
                navigator.clipboard.readText().then((t) => send({ type: "type", text: t })).catch(() => {});
                return;
              }
              send({ type: "keydown", key: e.key });
            }}
            onKeyUp={(e) => status === "streaming" && send({ type: "keyup", key: e.key })}
          />
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2 bg-gray-900 text-gray-400 text-xs">
          Click vào canvas để focus bàn phím · Scroll để cuộn trang · Ctrl+V để paste
        </div>
      </div>
    </div>
  );
}
