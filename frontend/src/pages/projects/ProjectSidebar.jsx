import React from "react";
import { Button } from "../../components/ui/button";

export default function ProjectSidebar({ projects, selectedId, onSelect, onDelete, onCreate, loading, loadingProjectId }) {
  return (
    <div className="w-60 shrink-0 border-r border-gray-200 bg-gray-50 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-3 py-3 border-b border-gray-200">
        <p className="text-sm font-semibold text-gray-900">Projects</p>
        <Button size="xs" variant="default" onClick={onCreate}>+ Tạo mới</Button>
      </div>

      {loading && projects.length === 0 ? (
        <p className="text-xs text-gray-400 px-3 py-4">Đang tải...</p>
      ) : projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-2 text-gray-300 px-4 py-8">
          <div className="text-4xl">📁</div>
          <p className="text-xs text-center">Chưa có project nào.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5 p-2 overflow-y-auto flex-1">
          {projects.map(p => {
            const isActive = p.id === selectedId;
            const isLoading = p.id === loadingProjectId;
            return (
              <div
                key={p.id}
                onClick={() => onSelect(p.id)}
                className={`rounded-lg border px-3 py-2.5 cursor-pointer transition-all group ${
                  isActive ? "border-sky-400 bg-sky-50 shadow-sm" : "border-gray-200 bg-white hover:bg-gray-50"
                }`}
              >
                <div className="flex items-start justify-between gap-1">
                  <p className={`text-sm font-semibold truncate ${
                    isActive ? "text-sky-800" : "text-gray-900"
                  }`}>{p.name}</p>
                  {isLoading ? (
                    <svg className="w-3.5 h-3.5 shrink-0 text-sky-500 animate-spin mt-0.5" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                    </svg>
                  ) : (
                    <button type="button"
                      onClick={e => { e.stopPropagation(); onDelete(p.id); }}
                      className="text-gray-200 hover:text-red-400 cursor-pointer text-xs shrink-0 hidden group-hover:inline"
                    >×</button>
                  )}
                </div>
                <div className="flex items-center gap-0.5 mt-2">
                  {[p.original, p.redesign, p.final].map((ph, i) => {
                    const s = ph?.status || "empty";
                    return (
                      <div key={i} className={`h-1.5 flex-1 rounded-full transition-all ${
                        isLoading ? "bg-sky-200 animate-pulse" :
                        s === "done" ? "bg-emerald-400" :
                        s === "empty" ? "bg-gray-200" : "bg-sky-400"
                      }`} />
                    );
                  })}
                </div>
                <div className="mt-1.5">
                  <p className="text-[0.65rem] text-gray-400">
                    {isLoading ? "Đang tải..." :
                     p.final?.status === "done" ? "✅ Hoàn thành" :
                     p.redesign?.status !== "empty" ? "✏️ Redesign" :
                     p.original?.status !== "empty" ? "🎯 Original" : "Chưa bắt đầu"}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
