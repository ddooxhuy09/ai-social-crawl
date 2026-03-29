import React from "react";
import { Search, ShoppingBag, ImageIcon, FolderKanban, GalleryHorizontalEnd, Sparkles, ClipboardList, MessageSquarePlus, Image } from "lucide-react";
import { cn } from "../lib/utils";

const NAV_ITEMS = [
  { id: "crawl", label: "Crawl theo keyword", icon: Search },
  { id: "hunt", label: "Etsy Hunt", icon: ShoppingBag },
  { id: "etsy-listing", label: "Etsy Listing AI", icon: Sparkles },
  { id: "pinterest-image", label: "Crawl by Image", icon: ImageIcon },
  { id: "projects", label: "Projects", icon: FolderKanban },
  { id: "main-image", label: "Main Image", icon: Image },
  { id: "chat-create-image", label: "Chat Create Image", icon: MessageSquarePlus },
  { id: "requirements", label: "Product Requirements", icon: ClipboardList },
];

export default function AppSidebar({ activeTab, onSelect }) {
  return (
    <aside className="flex flex-col w-[220px] min-h-screen bg-zinc-950 text-zinc-100 shrink-0">
      {/* Logo / Title */}
      <div className="px-5 py-5 border-b border-zinc-800">
        <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest">
          AI Pinterest
        </p>
        <h1 className="text-base font-bold text-white mt-0.5 leading-tight">
          Social Crawler
        </h1>
      </div>

      {/* Nav */}
      <nav className="flex flex-col gap-1 p-3 flex-1">
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onSelect(id)}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium w-full text-left transition-colors",
              activeTab === id
                ? "bg-zinc-700 text-white"
                : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            )}
          >
            <Icon size={16} className="shrink-0" />
            {label}
          </button>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-zinc-800 text-xs text-zinc-500">
        v1.0.0
      </div>
    </aside>
  );
}
