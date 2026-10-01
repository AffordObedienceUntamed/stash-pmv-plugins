// What's new: the patch notes shown on the "What's new" page (newest first).
// Every release that changes something you can see gets an entry; en + zh (Simplified Chinese).
// app: "ui" = Stash UI, "pmv" = PMV Generator, "storm" = Media Storm

export const CHANGES = [
  {
    v: "3.31.0",
    date: "2026-10-01",
    items: [
      ["ui", "New: this page – what changed in every version.", "新增：本页面——每个版本的更新内容。"],
      ["ui", "Player: the play mode button looks like the other toggles when it's on; “Repeat this video” has the 1 inside its icon.", "播放器：播放模式按钮开启时的样式与其他开关一致；“单集循环”图标中的 1 现在位于图标内部。"],
      ["ui", "Versus: more under each card – performers, studio, resolution, rating, plays and tags (performers: age, country, scenes and images).", "Versus：每张卡片下显示更多信息——演员、工作室、分辨率、评分、播放次数和标签（演员：年龄、国家、场景和图片数量）。"],
    ],
  },
  {
    v: "3.30.0",
    date: "2026-10-01",
    items: [
      ["ui", "Statistics: achievements – a streak of days in a row and medals in steps (plays, hours, library seen, night owl, Versus picks, O).", "统计：成就——连续观看天数，以及分级奖牌（播放、时长、已看媒体库、夜猫子、Versus 选择、O）。"],
      ["pmv", "Remix of your favorites: clips from your Versus top scenes or your most watched ones.", "收藏混剪：片段可来自 Versus 前列场景或最常观看的场景。"],
    ],
  },
  {
    v: "3.29.0",
    date: "2026-10-01",
    items: [
      ["ui", "Versus for moments (markers). The best ones are marked gold in the player, J jumps there first and a random start lands on one.", "Versus 支持“时刻”（标记）。最佳时刻在播放器中显示为金色，按 J 先跳到那里，随机开始也会落在其中之一。"],
      ["pmv", "Best moments from Versus are where clips start most of the time.", "片段大多从 Versus 选出的最佳时刻开始。"],
    ],
  },
  {
    v: "3.28.0",
    date: "2026-10-01",
    items: [["ui", "Home page: “For you” (unwatched scenes with your top tags of the week) and “Long time no see” (favorites not watched for a month).", "首页：“为你推荐”（带有你本周常看标签的未看场景）和“好久没看了”（一个月没看过的收藏）。"]],
  },
  {
    v: "3.27.0",
    date: "2026-10-01",
    items: [
      ["ui", "Smart playlists: save the filters of a list as a playlist – always up to date. Play, shuffle or add to the queue from the new Playlists page.", "智能播放列表：把列表的筛选条件保存为播放列表——始终保持最新。可在新的播放列表页面播放、随机播放或加入队列。"],
      ["pmv", "Clips can come from a playlist.", "片段可以来自播放列表。"],
      ["storm", "Performers, resolution, video length and playlists as filters.", "新增演员、分辨率、视频时长和播放列表筛选。"],
    ],
  },
  {
    v: "3.26.0",
    date: "2026-10-01",
    items: [["ui", "Statistics redone: your week, a period to choose with comparison, clear charts, top lists with trends, when you watch, your library.", "统计全面改版：你的一周、可选时间段及对比、清晰的图表、带趋势的排行、观看时间分布、你的媒体库。"]],
  },
  {
    v: "3.25.0",
    date: "2026-10-01",
    items: [
      ["ui", "Versus standings are kept in Stash – the same in every browser.", "Versus 排名保存在 Stash 中——所有浏览器都一样。"],
      ["pmv", "“My settings” works again and is kept in Stash.", "“我的设置”恢复正常，并保存在 Stash 中。"],
      ["ui", "Setting a cover in the player is instant and can be undone.", "在播放器中设置封面即时生效，并且可以撤销。"],
    ],
  },
  {
    v: "3.24.5",
    date: "2026-10-01",
    items: [["ui", "Ratings follow the rating system chosen in Stash (half, quarter, tenth stars or 0–10) – also settable under Settings → General.", "评分遵循 Stash 中选择的评分方式（半星、四分之一星、十分之一星或 0–10）——也可以在 设置 → 常规 中设置。"]],
  },
  {
    v: "3.24.0",
    date: "2026-09-30",
    items: [
      ["ui", "Versus: two side by side – pick the better one; Elo ranking, three ways to play, fullscreen, sound on hover.", "Versus：两个并排——选出更好的一个；Elo 排名、三种玩法、全屏、悬停有声音。"],
      ["ui", "Player: start at a random spot (your resume point stays).", "播放器：从随机位置开始（续播位置保持不变）。"],
      ["ui", "GIFs play again.", "GIF 恢复播放。"],
    ],
  },
  {
    v: "3.23.0",
    date: "2026-09-30",
    items: [
      ["ui", "Custom home page, markers in the player, cover from the current frame, performers on scenes, studio logos, foldable menu.", "可自定义首页、播放器中的标记、用当前画面做封面、场景上的演员、工作室标志、可折叠菜单。"],
      ["pmv", "Smooth with 4K, hide the bar (H), clip info (I), saved settings, more filters, long DJ mixes, Plex and Spotify.", "4K 也流畅、隐藏工具栏（H）、片段信息（I）、保存设置、更多筛选、长 DJ 混音、Plex 和 Spotify。"],
    ],
  },
];

export const LATEST = CHANGES[0].v;
