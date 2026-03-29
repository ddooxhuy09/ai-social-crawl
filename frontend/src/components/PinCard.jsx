import React from "react";
import { SOURCE_LABELS } from "../constants";
import { cn } from "../lib/utils";

const SOURCE_TEXT = {
  pinterest: "text-rose-600",
  instagram: "text-violet-600",
  tiktok: "text-pink-600",
  reddit: "text-orange-600",
  youtube: "text-red-600",
};

function StatBadge({ className, title, children }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-1.5 py-0.5 text-[0.6rem] font-medium leading-none", className)} title={title}>
      {children}
    </span>
  );
}

// Pinterest: icon + count theo style SortPin (ô trắng + badge teal/gray)
function PinterestStatItem({ title, iconColorClass, icon, value }) {
  const n = Number(value) || 0;
  const countClass = n > 0 ? "bg-teal-100 text-teal-800" : "bg-gray-100 text-gray-800";
  return (
    <div className="flex items-center gap-1 text-sm font-medium" title={title}>
      <span className="bg-white flex items-center rounded-md px-1.5 py-0.5 border border-gray-100 shadow-sm">
        <span className={cn("w-4 h-4 flex-shrink-0", iconColorClass)}>{icon}</span>
      </span>
      <span className={cn("inline-block py-0.5 px-1.5 text-xs rounded", countClass)}>
        {n.toLocaleString()}
      </span>
    </div>
  );
}

const IconSaves = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-full h-full">
    <path d="M9.653 16.915l-.005-.003-.019-.01a20.759 20.759 0 01-1.162-.682 22.045 22.045 0 01-2.582-1.9C4.045 12.733 2 10.352 2 7.5a4.5 4.5 0 018-2.828A4.5 4.5 0 0118 7.5c0 2.852-2.044 5.233-3.885 6.82a22.049 22.049 0 01-3.744 2.582l-.019.01-.005.003h-.002a.739.739 0 01-.69.001l-.002-.001z" />
  </svg>
);
const IconReactions = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-full h-full">
    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.536-4.464a.75.75 0 10-1.061-1.061 3.5 3.5 0 01-4.95 0 .75.75 0 00-1.06 1.06 5 5 0 007.07 0zM9 8.5c0 .828-.448 1.5-1 1.5s-1-.672-1-1.5S7.448 7 8 7s1 .672 1 1.5zm3 1.5c.552 0 1-.672 1-1.5S12.552 7 12 7s-1 .672-1 1.5.448 1.5 1 1.5z" clipRule="evenodd" />
  </svg>
);
const IconRepins = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-full h-full">
    <path fillRule="evenodd" d="M15.621 4.379a3 3 0 00-4.242 0l-7 7a3 3 0 004.241 4.243h.001l.497-.5a.75.75 0 011.064 1.057l-.498.501-.002.002a4.5 4.5 0 01-6.364-6.364l7-7a4.5 4.5 0 016.368 6.36l-3.455 3.553A2.625 2.625 0 119.52 9.52l3.45-3.451a.75.75 0 111.061 1.06l-3.45 3.451a1.125 1.125 0 001.587 1.595l3.454-3.553a3 3 0 000-4.242z" clipRule="evenodd" />
  </svg>
);
const IconComments = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-full h-full">
    <path fillRule="evenodd" d="M10 2c-2.236 0-4.43.18-6.57.524C1.993 2.755 1 4.014 1 5.426v5.148c0 1.413.993 2.67 2.43 2.902.848.137 1.705.248 2.57.331v3.443a.75.75 0 001.28.53l3.58-3.579a.78.78 0 01.527-.224 41.202 41.202 0 005.183-.5c1.437-.232 2.43-1.49 2.43-2.903V5.426c0-1.413-.993-2.67-2.43-2.902A41.289 41.289 0 0010 2zm0 7a1 1 0 100-2 1 1 0 000 2zM8 8a1 1 0 11-2 0 1 1 0 012 0zm5 1a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
  </svg>
);
const IconShares = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-full h-full">
    <path d="M13 4.5a2.5 2.5 0 11.702 1.737L6.97 9.604a2.518 2.518 0 010 .792l6.733 3.367a2.5 2.5 0 11-.671 1.341l-6.733-3.367a2.5 2.5 0 110-3.475l6.733-3.366A2.52 2.52 0 0113 4.5z" />
  </svg>
);

function PinterestStats({ pin }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-gray-800">
      <PinterestStatItem title="Saves" iconColorClass="text-red-600" icon={<IconSaves />} value={pin.save_count ?? pin.repin_count ?? 0} />
      <PinterestStatItem title="Reactions" iconColorClass="text-amber-600" icon={<IconReactions />} value={pin.reaction_count ?? pin.like_count ?? 0} />
      <PinterestStatItem title="Repins" iconColorClass="text-rose-600" icon={<IconRepins />} value={pin.repin_count ?? 0} />
      <PinterestStatItem title="Comments" iconColorClass="text-gray-600" icon={<IconComments />} value={pin.comment_count ?? 0} />
      <PinterestStatItem title="Shares" iconColorClass="text-gray-600" icon={<IconShares />} value={pin.share_count ?? 0} />
    </div>
  );
}

function InstagramStats({ pin }) {
  return (
    <>
      <StatBadge className="bg-red-100 text-red-700" title="Likes">❤️ {(pin.like_count ?? 0).toLocaleString()}</StatBadge>
      <StatBadge className="bg-gray-100 text-gray-600" title="Comments">💬 {(pin.comment_count ?? 0).toLocaleString()}</StatBadge>
    </>
  );
}

function TikTokStats({ pin }) {
  return (
    <>
      <StatBadge className="bg-cyan-100 text-cyan-700" title="Views">👁️ {(pin.view_count ?? 0).toLocaleString()}</StatBadge>
      <StatBadge className="bg-red-100 text-red-700" title="Likes">❤️ {(pin.like_count ?? 0).toLocaleString()}</StatBadge>
      <StatBadge className="bg-gray-100 text-gray-600" title="Comments">💬 {(pin.comment_count ?? 0).toLocaleString()}</StatBadge>
      <StatBadge className="bg-green-100 text-green-700" title="Saves">⭐ {(pin.save_count ?? 0).toLocaleString()}</StatBadge>
      <StatBadge className="bg-blue-100 text-blue-700" title="Shares">↗️ {(pin.share_count ?? 0).toLocaleString()}</StatBadge>
    </>
  );
}

function YouTubeStats({ pin }) {
  return (
    <>
      <StatBadge className="bg-cyan-100 text-cyan-700" title="Views">👁️ {(pin.view_count ?? 0).toLocaleString()}</StatBadge>
      <StatBadge className="bg-red-100 text-red-700" title="Likes">❤️ {(pin.like_count ?? 0).toLocaleString()}</StatBadge>
      <StatBadge className="bg-gray-100 text-gray-600" title="Comments">💬 {(pin.comment_count ?? 0).toLocaleString()}</StatBadge>
    </>
  );
}

function RedditStats({ pin }) {
  return (
    <>
      <StatBadge className="bg-orange-100 text-orange-700" title="Upvotes">▲ {(pin.like_count ?? 0).toLocaleString()}</StatBadge>
      <StatBadge className="bg-gray-100 text-gray-600" title="Comments">💬 {(pin.comment_count ?? 0).toLocaleString()}</StatBadge>
    </>
  );
}

function DefaultStats({ pin }) {
  return (
    <>
      <StatBadge className="bg-red-100 text-red-700" title="Likes">❤️ {(pin.like_count ?? pin.reaction_count ?? 0).toLocaleString()}</StatBadge>
      <StatBadge className="bg-gray-100 text-gray-600" title="Comments">💬 {(pin.comment_count ?? 0).toLocaleString()}</StatBadge>
    </>
  );
}

const STATS_BY_SOURCE = {
  pinterest: PinterestStats,
  instagram: InstagramStats,
  tiktok: TikTokStats,
  youtube: YouTubeStats,
  reddit: RedditStats,
};

export default function PinCard({ pin, onPick }) {
  const StatsComponent = STATS_BY_SOURCE[pin.source] || DefaultStats;

  return (
    <a
      href={pin.pin_url}
      target="_blank"
      rel="noreferrer"
      className="flex flex-col no-underline rounded-xl overflow-hidden bg-gray-50 border border-gray-200 hover:border-gray-300 hover:shadow-md transition-all"
    >
      {pin.image_url && (
        <img
          src={pin.image_url}
          alt={pin.title || pin.description || "pin"}
          className="w-full h-44 object-cover"
        />
      )}
      <div className="px-2.5 py-2 flex flex-col gap-1">
        {pin.source && (
          <div className={cn("text-[0.6rem] font-semibold uppercase tracking-wide", SOURCE_TEXT[pin.source] || "text-gray-500")}>
            {SOURCE_LABELS[pin.source] || pin.source}
          </div>
        )}

        {pin.similarity_score != null && (
          <div className="text-xs font-bold text-sky-500">Giống: {Math.round(pin.similarity_score * 100)}%</div>
        )}
        {pin.confidence_score != null && (
          <div className="text-xs font-bold text-violet-500">Độ khớp: {Math.round(pin.confidence_score * 100)}%</div>
        )}
        {pin.explanation && (
          <div className="text-[0.65rem] text-gray-500 italic line-clamp-2" title={pin.explanation}>
            {pin.explanation}
          </div>
        )}

        <div className="flex flex-wrap gap-0.5">
          <StatsComponent pin={pin} />
        </div>

        <div className="text-xs font-semibold text-gray-900">{pin.title || "(No title)"}</div>
        {pin.pinner_username && (
          <div className="text-[0.7rem] text-gray-500">@{pin.pinner_username}</div>
        )}
        {pin.board_name && (
          <div className="text-[0.65rem] text-gray-400 truncate">
            🔖 {pin.board_name}
          </div>
        )}
        {onPick && (
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onPick(pin); }}
            className="mt-1 w-full py-1.5 rounded-lg bg-emerald-500 text-white text-xs font-semibold hover:bg-emerald-600 transition-colors"
          >
            ✅ Chọn làm Original
          </button>
        )}
      </div>
    </a>
  );
}
