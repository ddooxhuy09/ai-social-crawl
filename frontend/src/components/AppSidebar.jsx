import React from "react";
import { NavLink } from "react-router-dom";
import { Search, ShoppingBag, ImageIcon, FolderKanban, Sparkles, ClipboardList, MessageSquarePlus, Heart, Globe } from "lucide-react";
import { cn } from "../lib/utils";

const NAV_ITEMS = [
  { id: "crawl",               label: "Crawl theo keyword",  icon: Search,          to: "/"                   },
  { id: "hunt",                label: "Etsy Hunt",           icon: ShoppingBag,     to: "/hunt"               },
  { id: "etsy-listing",        label: "Etsy Listing AI",     icon: Sparkles,        to: "/etsy-listing"       },
  { id: "pinterest-image",     label: "Crawl by Image",      icon: ImageIcon,       to: "/pinterest-image"    },
  { id: "projects",            label: "Projects",            icon: FolderKanban,    to: "/projects"           },
  { id: "chat-create-image",   label: "Chat Create Image",   icon: MessageSquarePlus, to: "/chat-create-image" },
  { id: "product-insights",    label: "Product Insights",     icon: Globe,             to: "/product-insights"    },

  { id: "user-favorite-items", label: "User Favorite Items", icon: Heart,           to: "/user-favorite-items" },
  { id: "requirements",        label: "Product Requirements",icon: ClipboardList,   to: "/requirements"       },
];

export default function AppSidebar() {
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
        {NAV_ITEMS.map(({ id, label, icon: Icon, to }) => (
          <NavLink
            key={id}
            to={to}
            end={to === "/"}
            className={({ isActive }) => cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium w-full text-left transition-colors",
              isActive
                ? "bg-zinc-700 text-white"
                : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            )}
          >
            <Icon size={16} className="shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-zinc-800 text-xs text-zinc-500">
        v1.0.0
      </div>
    </aside>
  );
}
