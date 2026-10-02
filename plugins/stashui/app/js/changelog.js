// What's new: the patch notes shown on the "What's new" page (newest first).
// Every release that changes something you can see gets an entry; en + zh (Simplified Chinese).
// app: "ui" = Stash UI, "pmv" = PMV Generator, "storm" = Media Storm

export const CHANGES = [
  {
    v: "3.47.0",
    date: "2026-10-02",
    items: [
      ["ui", "Detailed rating in lists: a Detailed filter in Scenes and Performers (“Chemistry ≥ 4”, several points together), a sort by any point (“Detailed: Chemistry”), small bars of a scene's scores on its card (on hover), score chips in the info panel and on performer pages – and playlists keep the filter.", "列表中的详细评分：场景和演员页面新增“详细”筛选（“默契 ≥ 4”，可组合多个评分项）、按任意评分项排序（“详细：默契”）、场景卡片上的小型分数条（悬停时显示）、信息面板和演员页面上的分数标签——播放列表也会保存该筛选。"],
      ["ui", "Keys for the detailed rating: R opens it in the player; in the list ↑ ↓ choose the point, 0–5 rate it and jump on, Backspace takes the rating away.", "详细评分快捷键：在播放器中按 R 打开；在列表中用 ↑ ↓ 选择评分项，按 0–5 评分并跳到下一项，Backspace 清除评分。"],
    ],
  },
  {
    v: "3.46.0",
    date: "2026-10-02",
    items: [
      ["ui", "Tiers everywhere: the S–F badge (from the Versus standings) now also sits on scene and image cards, performer cards, in the info panel, the player's title bar and on performer pages. Lists get a Tier filter (tick S, A …) for scenes, images and performers, and playlists can keep it – so “Best scenes: S + A” is a playlist that updates itself.", "等级无处不在：来自对决排名的 S–F 徽章现在也显示在场景和图片卡片、演员卡片、信息面板、播放器标题栏和演员页面上。列表新增“等级”筛选（勾选 S、A …），适用于场景、图片和演员，播放列表也可保存它——例如“最佳场景：S + A”就是一个会自动更新的播放列表。"],
    ],
  },
  {
    v: "3.45.0",
    date: "2026-10-02",
    items: [["ui", "Plugins → Sources: every source unfolds (arrow) to show the plugins inside – search them, tick several and “Install selected”, or install, update one by one. Installed ones are marked, like in classic Stash.", "插件 → 来源：每个来源都可展开（箭头）显示其中的插件——可搜索，勾选多个后“安装所选”，也可逐个安装或更新；已安装的会被标记，与经典 Stash 一样。"]],
  },
  {
    v: "3.44.0",
    date: "2026-10-02",
    items: [
      ["ui", "Event log as a floating panel (menu: Manage → Log; also the Log button in Versus): drag it by the header, resize it at the corner, fold it away – it stays open while you play or browse. It lists what Stash UI does – Versus picks (names link to the item, tiers colour-coded, wins green), funscript changes, ratings, tags and generate tasks – with filters per area, a clear button and an export as a text file in which names are left out (unless you untick “Hide names in the export”). Replaces the small Versus-only log.", "事件日志变为浮动面板（菜单：管理 → 日志；对决页面也有“日志”按钮）：拖动标题栏移动、拖拽角落调整大小、可折叠——在播放或浏览时保持打开。它列出 Stash UI 所做的事——对决选择（名称链接到条目，等级用颜色标注，胜利为绿色）、funscript 更改、评分、标签和生成任务——可按区域筛选，可清空，也可导出为文本文件（默认不含名称，可取消“导出时隐藏名称”）。取代原先仅限对决的小日志。"],
    ],
  },
  {
    v: "3.43.0",
    date: "2026-10-02",
    items: [
      ["ui", "Versus: tiers S – A – B – C – D – F by percentile (top 5 % S, then 15 %, 25 %, 30 %, 15 %, last 10 % F) among everything with 3+ matches – shown as a badge in the ranking, as a bar and as a filter; plus a small overview (compared, picks, average and highest points).", "对决：按百分位划分的 S – A – B – C – D – F 等级（前 5 % 为 S，然后 15 %、25 %、30 %、15 %，最后 10 % 为 F），统计对象为对决 3 场以上的条目——在排名中显示为徽章、分布条和筛选项；另有小型概览（已比较、选择次数、平均和最高积分）。"],
      ["ui", "Versus ledger: the little clock next to a ranking entry shows its last 10 matches (won / lost, points, against whom, when).", "对决记录：排名条目旁的小时钟显示其最近 10 场对决（胜/负、积分、对手、时间）。"],
      ["ui", "Versus snapshots: take a copy of all standings (kept in Stash, the last 5), restore one (a snapshot of the current state is made first), export the standings to a file and import them again.", "对决快照：为所有排名创建副本（保存在 Stash 中，最近 5 个），可恢复其中之一（之前会先为当前状态创建快照），也可将排名导出为文件并再次导入。"],
      ["ui", "Versus event log (picks, undo, restore, start over …) and match options (points per pick for new and settled ones, how many matches count as new).", "对决事件日志（选择、撤销、恢复、重新开始 …）以及对决选项（新加入和已稳定条目每次选择的积分、多少场以内算新）。"],
    ],
  },
  {
    v: "3.42.1",
    date: "2026-10-02",
    items: [["ui", "Detailed rating: the stars are now exactly those of the info bar – they light up when you hover and the new ones pop in after a click.", "详细评分：星星现在与信息栏中的完全一致——悬停时点亮，点击后新点亮的星星依次弹出。"]],
  },
  {
    v: "3.42.0",
    date: "2026-10-02",
    items: [
      ["ui", "Advanced rating: “★+ Detailed” next to the stars of a scene or performer opens a list of criteria (scenes: Production Quality, Chemistry, Performance …; performers: Face, Body, Technique … in groups) – rate each from 0 to 5 and Stash's own rating follows as the weighted result, snapped to your rating precision. The scores are tags (“Chemistry ★: 4” under “Advanced Rating System” / “Advanced Performer Rating”), so they work everywhere in Stash. “Customize …” edits groups, criteria, weights and tooltips, makes the tags, and can recalculate every rating. Idea: the Advanced Rating plugin on discourse.stashapp.cc (same tag names).", "高级评分：场景或演员星级旁的“★+ 详细”打开评分项列表（场景：制作质量、默契、表现 …；演员：脸、身材、技巧 … 按分组）——每项评 0 到 5 分，Stash 自己的评分随之按加权结果更新，并取整到你设置的评分精度。分数以标签保存（“Chemistry ★: 4”，位于“Advanced Rating System”/“Advanced Performer Rating”之下），因此在 Stash 中随处可用。“自定义 …”可编辑分组、评分项、权重和提示，创建标签，并可重新计算所有评分。灵感来自 discourse.stashapp.cc 上的 Advanced Rating 插件（标签名称相同）。"],
    ],
  },
  {
    v: "3.41.0",
    date: "2026-10-02",
    items: [
      ["ui", "The picture under the player's timeline follows the script in use: choose a variant and its intensity shows there (Stash's own heatmap stays for the video's own script).", "播放器时间轴下方的图像跟随当前使用的脚本：选择一个变体后，这里显示它的强度（视频自带脚本仍使用 Stash 自己的热力图）。"],
      ["ui", "Stacked heatmap: scripts with exactly the same movements are marked (white outline, “Same movements as …”) and can be set aside with one button – the one with the video's name always stays. New switch “Stretch each script to the full width” (default: aligned to the video's length).", "叠放热力图：动作完全相同的脚本会被标记（白色轮廓，“动作与……相同”），可一键搁置——与视频同名的脚本始终保留。新开关“将每个脚本拉伸至整个宽度”（默认按视频长度对齐）。"],
      ["ui", "Interactive → Problems: the tag names are editable (kept in the settings), and the speed check also finds scenes whose speed is 0 or below, not only missing ones; the task then measures them again (heatmap and speed of those scenes only).", "互动 → 问题：标签名称可编辑（保存在设置中）；速度检查现在也会找出速度为 0 或更低的场景，而不只是缺失的；任务会重新测量它们（仅这些场景的热力图和速度）。"],
    ],
  },
  {
    v: "3.40.0",
    date: "2026-10-02",
    items: [
      ["ui", "Interactive → Problems: shows how many interactive scenes Stash hasn't measured yet (no speed, so no heatmap or speed filter) and starts Stash's own task “Heatmaps for interactive videos” for exactly those scenes, with a confirmation. Nothing is written to the database directly.", "互动 → 问题：显示 Stash 尚未测量的互动场景数量（没有速度，因而没有热力图和速度筛选），并在确认后仅为这些场景启动 Stash 自带的任务“互动视频热力图”。不会直接写入数据库。"],
    ],
  },
  {
    v: "3.39.0",
    date: "2026-10-02",
    items: [
      ["ui", "Simple funscript editor (“Edit this script …” in the Handy menu and the Funscript list): stroke range, speed limit, smoothing, reverse and shift in time, with a before / after heatmap preview. It's saved as a new variant next to the video – the original is never touched. Your own presets are kept.", "简易 funscript 编辑器（Handy 菜单和 Funscript 列表中的“编辑此脚本 …”）：行程范围、速度上限、平滑、反转和时间偏移，附修改前/后热力图预览。结果另存为视频旁的新变体——原脚本不会被改动。可保存自己的预设。"],
      ["ui", "The scripts box in the Handy menu and the Funscript list now also shows for a video with a single script (its heatmap and the editor).", "Handy 菜单和 Funscript 列表中的脚本区现在也会显示只有一个脚本的视频（其热力图和编辑器）。"],
    ],
  },
  {
    v: "3.38.0",
    date: "2026-10-02",
    items: [
      ["ui", "Interactive → Duplicates: finds funscripts with exactly the same movements (names and metadata don't matter) and shows them in groups. Choose which one stays; the others are set aside as .funscriptdupe – nothing is deleted – and can be brought back from the same page.", "互动 → 重复：查找动作完全相同的 funscript（名称和元数据无关），并按组显示。选择保留哪一个；其余的会被搁置为 .funscriptdupe——不会删除任何文件——并可在同一页面恢复。"],
    ],
  },
  {
    v: "3.37.0",
    date: "2026-10-02",
    items: [
      ["ui", "Several funscripts per video: scripts next to the video that start with its name (“Video.funscript”, “Video (Soft).funscript”, “Video - Hard.funscript” …) are variants, labelled by the rest of the file name. Pick one in the Handy menu or the Funscript list – the Handy loads it and carries on from where the video is; the choice is remembered per scene.", "每个视频可有多个 funscript：视频旁以其名称开头的脚本（“Video.funscript”、“Video (Soft).funscript”、“Video - Hard.funscript” …）即为变体，以文件名其余部分作标签。在 Handy 菜单或 Funscript 列表中选择——Handy 加载后从视频当前位置继续；选择按场景记住。"],
      ["ui", "Stacked heatmap: every variant as a stripe with label, length and a click to choose it – in the Handy menu and the Funscript list.", "叠放热力图：每个变体一条，带标签、时长，点击即可选择——位于 Handy 菜单和 Funscript 列表中。"],
      ["ui", "Length check: a script that can't be read, has no movements, or is much longer or shorter than its video gets a warning (the stripe shows where it ends). New tab Problems on the Interactive page lists such scenes and the scenes with several scripts – each list can be set as a tag.", "长度检查：无法读取、没有动作、或比视频长得多/短得多的脚本会收到警告（条带显示其结束位置）。“互动”页面的新标签“问题”列出这些场景以及有多个脚本的场景——每个列表都可设为标签。"],
    ],
  },
  {
    v: "3.36.0",
    date: "2026-10-01",
    items: [
      ["ui", "New page Interactive (Watch): all scenes with a funscript, as a normal list – and the funscripts in your library that don't belong to a video yet, each with “Choose video …” (similar names first, or search).", "新页面“互动”（观看）：所有带 funscript 的场景，以普通列表显示——以及媒体库中尚未属于任何视频的 funscript，每个都可“选择视频 …”（名称相似的优先，也可搜索）。"],
    ],
  },
  {
    v: "3.35.2",
    date: "2026-10-01",
    items: [["ui", "Funscript list: the script you picked last is the one marked “in use” – the copy next to the video isn't listed as an extra entry any more.", "Funscript 列表：标记为“使用中”的是你最后选择的脚本——视频旁边的副本不再作为单独条目列出。"]],
  },
  {
    v: "3.35.1",
    date: "2026-10-01",
    items: [
      ["ui", "The Handy gets the newly chosen funscript right away (it kept playing the old one).", "选择新的 funscript 后，Handy 会立即使用它（之前会继续播放旧的）。"],
      ["ui", "Back in the player leaves with one click after choosing a funscript (it needed several).", "选择 funscript 后，播放器中的返回按钮点一次即可退出（之前需要点好几次）。"],
    ],
  },
  {
    v: "3.35.0",
    date: "2026-10-01",
    items: [
      ["ui", "“Funscript” in the player now lists every .funscript in your Stash folders – the ones matching the video first, with search. Pick one and it stays with the scene (also after a restart, also in classic Stash); switch or remove it any time.", "播放器中的“Funscript”现在会列出 Stash 文件夹中的所有 .funscript——与视频匹配的排在前面，并可搜索。选中后它会一直属于该场景（重启后、在经典 Stash 中也一样）；随时可以更换或移除。"],
    ],
  },
  {
    v: "3.34.0",
    date: "2026-10-01",
    items: [
      ["ui", "The Handy menu in the player (click the Handy button): sync offset, stroke range, invert, the device with its firmware, the connection key, connect again or disconnect.", "播放器中的 Handy 菜单（点击 Handy 按钮）：同步偏移、行程范围、反转、设备及固件信息、连接密钥、重新连接或断开。"],
      ["ui", "Give a scene a funscript right from the player (“Funscript” in the info bar): it's put next to the video with the right name, Stash scans it, and the scene plays on the Handy.", "可直接在播放器中为场景添加 funscript（信息栏中的“Funscript”）：文件会以正确的名称放在视频旁边，Stash 扫描后即可在 Handy 上播放。"],
      ["ui", "The Handy connection key is shown in full.", "Handy 连接密钥完整显示。"],
    ],
  },
  {
    v: "3.33.0",
    date: "2026-10-01",
    items: [
      ["ui", "Interactive: scenes with a funscript play on The Handy – it follows play, pause, jumps and repeat. Settings → Player and previews (the same settings as classic Stash), with a connection test. The funscript intensity shows under the timeline.", "互动：带 funscript 的场景可在 The Handy 上播放——跟随播放、暂停、跳转和循环。设置 → 播放器与预览（与经典 Stash 相同的设置），可测试连接。时间轴下方显示 funscript 强度。"],
      ["ui", "Lists: filter by funscript; scenes with one get a small mark.", "列表：可按 funscript 筛选；带 funscript 的场景有小标记。"],
    ],
  },
  {
    v: "3.32.0",
    date: "2026-10-01",
    items: [["ui", "Player: buttons to start from the beginning (also the Home key) and to jump 10 seconds back or forward, with a short note on the picture.", "播放器：新增“从头开始”（也可按 Home 键）以及后退/前进 10 秒按钮，画面上会短暂显示提示。"]],
  },
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
