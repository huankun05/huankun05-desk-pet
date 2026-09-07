import React from "react";

/**
 * 工具面板专属 SVG 图标库。
 * 每个工具一个 48 viewBox 线性图标（stroke=currentColor），容器内随文字色/置灰态自适应。
 * 未覆盖的工具 id 由调用方回退占位图标。
 */

function I({ children, ...rest }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth="4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

/* ── Git 类 ─────────────────────────────── */
const GitBranchIcon = () => (
  <I>
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="36" r="5" />
    <circle cx="36" cy="36" r="5" />
    <path d="M12 17V31M12 17C12 17 14 25 36 31" />
  </I>
);

const GitInitIcon = () => (
  <I>
    <rect x="10" y="6" width="28" height="36" rx="4" />
    <path d="M10 18H38" />
    <circle cx="24" cy="27" r="4" />
  </I>
);

const GitCommitIcon = () => (
  <I>
    <path d="M8 24H18M30 24H40" />
    <circle cx="24" cy="24" r="6" />
  </I>
);

const GitSwitchIcon = () => (
  <I>
    <path d="M8 16H30C35 16 38 19 38 24V38" />
    <path d="M33 33L38 38L43 33" />
    <circle cx="8" cy="32" r="5" />
    <path d="M13 32H20" />
  </I>
);

const GitPushIcon = () => (
  <I>
    <path d="M24 8V30" />
    <path d="M17 15L24 8L31 15" />
    <path d="M10 38H38" />
    <circle cx="24" cy="36" r="5" />
  </I>
);

const GitRevertIcon = () => (
  <I>
    <path d="M30 10C37 12 42 18 42 25C42 33 35 40 27 40H16" />
    <path d="M8 30L16 40L24 30" />
  </I>
);

const GitDiffIcon = () => (
  <I>
    <path d="M10 8V40" />
    <path d="M10 8L4 14M10 8L16 14" />
    <path d="M38 8V40" />
    <path d="M38 40L32 34M38 40L44 34" />
    <circle cx="10" cy="30" r="3" fill="currentColor" stroke="none" />
    <circle cx="38" cy="18" r="3" fill="currentColor" stroke="none" />
  </I>
);

const GitLogIcon = () => (
  <I>
    <circle cx="12" cy="24" r="4" />
    <circle cx="36" cy="14" r="4" />
    <circle cx="36" cy="34" r="4" />
    <path d="M16 24H32" />
    <path d="M16 14H22M16 34H22" />
  </I>
);

/* ── 代码 / 编辑类 ──────────────────────── */
const SearchCodeIcon = () => (
  <I>
    <path d="M14 8H34C37.3 8 40 10.7 40 14V28C40 31.3 37.3 34 34 34H14C10.7 34 8 31.3 8 28V14C8 10.7 10.7 8 14 8Z" />
    <path d="M17 14L12 19L17 24" />
    <path d="M31 14L36 19L31 24" />
    <path d="M26 12L22 26" />
  </I>
);

const SearchTextIcon = () => (
  <I>
    <path d="M12 10H36" />
    <path d="M12 18H28" />
    <path d="M12 26H24" />
    <path d="M30 40L36 34L40 38" />
    <circle cx="33" cy="31" r="7" />
  </I>
);

const LspIcon = () => (
  <I>
    <path d="M24 8C16 8 10 14 10 22C10 27 13 31 17 33V38C17 39.7 18.3 41 20 41H28C29.7 41 31 39.7 31 38V33C35 31 38 27 38 22C38 14 32 8 24 8Z" />
    <path d="M18 30H30" />
  </I>
);

const ApplyPatchIcon = () => (
  <I>
    <path d="M10 8H38V34L28 42H10V8Z" />
    <path d="M28 34V42L38 34" />
    <path d="M19 20V28M15 24H23" />
  </I>
);

const StrReplaceIcon = () => (
  <I>
    <path d="M12 12H20" />
    <path d="M8 16L14 10" />
    <circle cx="24" cy="24" r="8" />
    <path d="M36 36H28" />
    <path d="M40 32L34 38" />
  </I>
);

const AstGrepSearchIcon = () => (
  <I>
    <path d="M12 8H36V20" />
    <path d="M12 8L6 15M12 8L18 15" />
    <path d="M12 20V40" />
    <circle cx="24" cy="30" r="6" />
    <circle cx="36" cy="30" r="6" />
    <path d="M30 28L36 24" />
  </I>
);

const AstGrepReplaceIcon = () => (
  <I>
    <path d="M12 8H36V20" />
    <path d="M12 8L6 15M12 8L18 15" />
    <path d="M12 20V40" />
    <circle cx="24" cy="30" r="6" />
    <circle cx="36" cy="30" r="6" />
    <path d="M28 33L32 27" />
  </I>
);

const RunShellIcon = () => (
  <I>
    <rect x="6" y="10" width="36" height="28" rx="4" />
    <path d="M13 18L19 24L13 30" />
    <path d="M24 30H35" />
  </I>
);

const RunVerificationIcon = () => (
  <I>
    <path d="M24 6L38 12V24C38 34 32 40 24 43C16 40 10 34 10 24V12L24 6Z" />
    <path d="M17 24L22 29L31 19" />
  </I>
);

const ExecuteCodeIcon = () => (
  <I>
    <path d="M14 8H34C37.3 8 40 10.7 40 14V28C40 31.3 37.3 34 34 34H14C10.7 34 8 31.3 8 28V14C8 10.7 10.7 8 14 8Z" />
    <path d="M21 16L28 21L21 26" />
    <path d="M29 28H37" />
  </I>
);

/* ── 文件 / 文档类 ──────────────────────── */
const ReadFileIcon = () => (
  <I>
    <path d="M14 4H30L38 12V44H14V4Z" />
    <path d="M30 4V12H38" />
    <path d="M19 21H33M19 27H33M19 33H28" />
  </I>
);

const WriteFileIcon = () => (
  <I>
    <path d="M14 4H30L38 12V44H14V4Z" />
    <path d="M30 4V12H38" />
    <path d="M20 33L30 23L34 27L24 37L19 38L20 33Z" />
  </I>
);

const ListDirIcon = () => (
  <I>
    <path d="M6 12C6 9.8 7.8 8 10 8H18L22 12H38C40.2 12 42 13.8 42 16V34C42 36.2 40.2 38 38 38H10C7.8 38 6 36.2 6 34V12Z" />
  </I>
);

const WriteMarkdownIcon = () => (
  <I>
    <path d="M14 4H30L38 12V44H14V4Z" />
    <path d="M30 4V12H38" />
    <path d="M16 22H32" />
    <path d="M16 30H28" />
  </I>
);

const WriteExcelIcon = () => (
  <I>
    <rect x="6" y="6" width="36" height="36" rx="4" />
    <path d="M6 16H42M16 6V42M28 6V42" />
    <path d="M12 24L20 32M20 24L12 32" />
  </I>
);

const WriteWordIcon = () => (
  <I>
    <rect x="6" y="6" width="36" height="36" rx="4" />
    <path d="M6 16H42" />
    <path d="M16 24L20 36L24 28L28 36L32 24" />
  </I>
);

const WritePdfIcon = () => (
  <I>
    <rect x="6" y="6" width="36" height="36" rx="4" />
    <path d="M6 16H42" />
    <path d="M14 24V36H18C20.8 36 22 34.2 22 31C22 27.8 20.8 26 18 26H14V24Z" />
    <path d="M30 24V36" />
    <path d="M30 24H32C35.3 24 37 25.8 37 29C37 32.2 35.3 34 32 34H30" />
  </I>
);

/* ── 记忆类 ─────────────────────────────── */
const UserMemoryIcon = () => (
  <I>
    <circle cx="24" cy="16" r="8" />
    <path d="M10 40C10 32 16 28 24 28C32 28 38 32 38 40" />
  </I>
);

const ReadMemoryIcon = () => (
  <I>
    <path d="M10 8H32C35 8 37 10 37 13V40H10V8Z" />
    <path d="M37 15H40C42.2 15 43 16.8 43 19V37C43 39.2 41.2 41 39 41H14" />
    <path d="M24 13V33" />
    <path d="M17 18L24 13L31 18" />
  </I>
);

const WriteMemoryIcon = () => (
  <I>
    <path d="M10 8H32C35 8 37 10 37 13V40H10V8Z" />
    <path d="M20 26L30 16L34 20L24 30L18 32L20 26Z" />
  </I>
);

const RecallHistoryIcon = () => (
  <I>
    <circle cx="24" cy="24" r="16" />
    <path d="M24 14V24L31 28" />
    <path d="M8 16L14 8" />
  </I>
);

const ImportedDocsIcon = () => (
  <I>
    <path d="M14 6H34C36.2 6 38 7.8 38 10V42H10V10C10 7.8 11.8 6 14 6Z" />
    <path d="M24 18V32" />
    <path d="M17 25L24 32L31 25" />
  </I>
);

/* ── 网络 / 通讯类 ──────────────────────── */
const WebSearchIcon = () => (
  <I>
    <circle cx="21" cy="21" r="12" />
    <path d="M9 21H33M21 9C14 14 14 28 21 33C28 28 28 14 21 9Z" />
    <path d="M30 30L40 40" />
  </I>
);

const FetchUrlIcon = () => (
  <I>
    <path d="M14 24C14 17 19 12 26 12H32C39 12 42 17 42 24C42 31 37 36 30 36H26" />
    <path d="M34 24H14" />
  </I>
);

const TranslateIcon = () => (
  <I>
    <path d="M8 12H28M18 8V16" />
    <path d="M18 12C18 18 14 24 8 28" />
    <path d="M24 18C21 24 16 28 12 30" />
    <path d="M28 40L36 20L44 40M31 33H41" />
  </I>
);

const ExchangeRateIcon = () => (
  <I>
    <circle cx="18" cy="18" r="9" />
    <path d="M14 15H22M14 21H22M18 12V24M14 24C15.5 27 20.5 27 22 24" />
    <circle cx="32" cy="32" r="9" />
    <path d="M28 29H36M28 35H36M32 26V38" />
  </I>
);

const WeatherIcon = () => (
  <I>
    <circle cx="22" cy="16" r="6" />
    <path d="M22 6V8M22 24V26M12 16H14M30 16H32M15 9L16.5 10.5M27.5 21.5L29 23M29 9L27.5 10.5M16.5 21.5L15 23" />
    <path d="M12 34H34C37 34 39 31 39 28C39 24.5 36 24 34 24C34 21 30 20 28 22C26 19 21 21 22 25C19 25 16 27 16 31C16 33 14 34 12 34Z" />
  </I>
);

const SendEmailIcon = () => (
  <I>
    <rect x="6" y="10" width="36" height="28" rx="4" />
    <path d="M8 14L24 26L40 14" />
  </I>
);

const InstallMcpIcon = () => (
  <I>
    <rect x="10" y="6" width="28" height="14" rx="3" />
    <rect x="10" y="28" width="28" height="14" rx="3" />
    <circle cx="18" cy="13" r="3" fill="currentColor" stroke="none" />
    <circle cx="18" cy="35" r="3" fill="currentColor" stroke="none" />
    <path d="M30 13H35M30 35H35" />
  </I>
);

/* ── 音乐类 ─────────────────────────────── */
const MusicNoteIcon = () => (
  <I>
    <path d="M18 34V12L36 8V30" />
    <circle cx="14" cy="34" r="5" />
    <circle cx="32" cy="30" r="5" />
  </I>
);

const MusicSearchIcon = () => (
  <I>
    <path d="M14 34V12L32 8V30" />
    <circle cx="10" cy="34" r="5" />
    <circle cx="28" cy="30" r="5" />
    <path d="M38 40L33 35" />
  </I>
);

const MusicPlayTrackIcon = () => (
  <I>
    <path d="M16 34V12L36 8V30" />
    <circle cx="12" cy="34" r="5" />
    <circle cx="32" cy="30" r="5" />
    <path d="M14 30L20 33L14 36V30Z" fill="currentColor" stroke="none" />
  </I>
);

const MusicPlayPlaylistIcon = () => (
  <I>
    <path d="M8 10H36" />
    <path d="M8 18H28" />
    <path d="M8 26H20" />
    <path d="M28 26L38 22V38" />
    <circle cx="26" cy="38" r="4" />
  </I>
);

const MusicStatusIcon = () => (
  <I>
    <path d="M6 20V28M14 12V36M22 18V30M30 8V40M38 24V24" />
  </I>
);

const MusicStopIcon = () => (
  <I>
    <rect x="12" y="12" width="24" height="24" rx="3" />
    <path d="M20 20H28V28H20Z" fill="currentColor" stroke="none" />
  </I>
);

const MusicPlaylistsIcon = () => (
  <I>
    <path d="M8 10H36" />
    <path d="M8 18H28" />
    <path d="M8 26H20" />
    <path d="M26 40L34 34L26 28Z" />
  </I>
);

const MusicPlaylistDetailIcon = () => (
  <I>
    <path d="M8 8H40V40H8V8Z" />
    <path d="M14 16H34" />
    <path d="M14 24H26" />
    <path d="M14 32H34" />
    <path d="M30 24L38 28L30 32V24Z" fill="currentColor" stroke="none" />
  </I>
);

const MusicCreatePlaylistIcon = () => (
  <I>
    <path d="M8 12H40" />
    <path d="M8 20H26" />
    <path d="M8 28H20" />
    <circle cx="32" cy="30" r="7" />
    <path d="M32 26.5V33.5M28.5 30H35.5" />
  </I>
);

const MusicAddToPlaylistIcon = () => (
  <I>
    <path d="M8 10H36" />
    <path d="M8 18H24" />
    <path d="M8 26H20" />
    <path d="M32 24V40M24 32H40" />
  </I>
);

const MusicFavoriteIcon = () => (
  <I>
    <path d="M24 40C24 40 6 30 6 18C6 12 10 8 15 8C19 8 23 10 24 14C25 10 29 8 33 8C38 8 42 12 42 18C42 30 24 40 24 40Z" />
  </I>
);

const MusicRemoveFromPlaylistIcon = () => (
  <I>
    <path d="M8 10H36" />
    <path d="M8 18H24" />
    <path d="M8 26H20" />
    <path d="M30 26V38M24 32H36" />
  </I>
);

const MusicDailyIcon = () => (
  <I>
    <path d="M15 33V11L35 7V29" />
    <circle cx="11" cy="33" r="5" />
    <circle cx="31" cy="29" r="5" />
    <path d="M22 40L23.5 37L26.5 35.5L23.5 34L22 31L20.5 34L17.5 35.5L20.5 37L22 40Z" fill="currentColor" stroke="none" />
  </I>
);

const MusicSubscriptionsIcon = () => (
  <I>
    <path d="M24 8C17 8 12 13 12 20V30L8 36H40L36 30V20C36 13 31 8 24 8Z" />
    <path d="M18 40C18 42 20 44 24 44C28 44 30 42 30 40" />
  </I>
);

const MusicCachedIcon = () => (
  <I>
    <path d="M14 6H34C36.2 6 38 7.8 38 10V42H10V10C10 7.8 11.8 6 14 6Z" />
    <path d="M24 18V32" />
    <path d="M17 25L24 32L31 25" />
  </I>
);

const MusicRemoveCachedIcon = () => (
  <I>
    <path d="M14 6H34C36.2 6 38 7.8 38 10V42H10V10C10 7.8 11.8 6 14 6Z" />
    <path d="M18 24L30 36M30 24L18 36" />
  </I>
);

/* ── 日程 / 动作类 ──────────────────────── */
const ScheduleTaskIcon = () => (
  <I>
    <circle cx="24" cy="24" r="16" />
    <path d="M24 14V24L30 29" />
    <path d="M14 8V4M34 8V4" />
  </I>
);

const PlanTripIcon = () => (
  <I>
    <circle cx="24" cy="24" r="16" />
    <circle cx="24" cy="24" r="4" fill="currentColor" stroke="none" />
    <path d="M12 8L24 8M36 8L40 4" />
  </I>
);

const PlayLive2dIcon = () => (
  <I>
    <circle cx="24" cy="24" r="16" />
    <path d="M20 18L30 24L20 30V18Z" fill="currentColor" stroke="none" />
  </I>
);

/* ── 财务类 ─────────────────────────────── */
const RecordExpenseIcon = () => (
  <I>
    <circle cx="24" cy="24" r="16" />
    <path d="M24 14V34M14 24H34" />
  </I>
);

const QueryExpenseIcon = () => (
  <I>
    <circle cx="24" cy="24" r="10" />
    <path d="M19 21H29M19 27H29" />
    <circle cx="24" cy="24" r="3" fill="currentColor" stroke="none" />
    <path d="M30 30L40 40" />
  </I>
);

/* ── 技能类 ─────────────────────────────── */
const InvokeSkillIcon = () => (
  <I>
    <path d="M26 4L10 26H22L20 44L38 20H25L26 4Z" />
  </I>
);

const ReadSkillRefIcon = () => (
  <I>
    <path d="M10 8H30C34 8 37 10 37 14V40H10V8Z" />
    <path d="M37 17H41C43.2 17 44 18.8 44 21V39C44 41.2 42.2 43 40 43H14" />
    <path d="M17 17H27" />
  </I>
);

const SkillListIcon = () => (
  <I>
    <path d="M10 12H38M10 24H38M10 36H38" />
    <circle cx="10" cy="12" r="3" fill="currentColor" stroke="none" />
    <circle cx="10" cy="24" r="3" fill="currentColor" stroke="none" />
    <circle cx="10" cy="36" r="3" fill="currentColor" stroke="none" />
  </I>
);

const SkillViewIcon = () => (
  <I>
    <path d="M4 24C4 24 10 12 24 12C38 12 44 24 44 24C44 24 38 36 24 36C10 36 4 24 4 24Z" />
    <circle cx="24" cy="24" r="7" />
  </I>
);

const SkillManageIcon = () => (
  <I>
    <path d="M14 8V16M14 32V40M24 8V14M24 30V40M34 8V22M34 32V40" />
    <circle cx="14" cy="24" r="5" />
    <circle cx="24" cy="22" r="5" />
    <circle cx="34" cy="27" r="5" />
  </I>
);

const SkillCuratorIcon = () => (
  <I>
    <rect x="8" y="8" width="14" height="14" rx="3" />
    <rect x="26" y="8" width="14" height="14" rx="3" />
    <rect x="8" y="26" width="14" height="14" rx="3" />
    <rect x="26" y="26" width="14" height="14" rx="3" />
    <circle cx="33" cy="33" r="4" fill="currentColor" stroke="none" />
  </I>
);

const RecommendSkillIcon = () => (
  <I>
    <path d="M8 22H18V40H8V22Z" />
    <path d="M22 40V24L26 18C28 14 30 14 32 16C34 18 33 21 31 24H37C40 24 41 27 39 29C41 31 39 34 37 34H33C32 34 31 35 30 37C29 39 27 40 24 40H22Z" />
  </I>
);

/* ── 工具 id → 图标映射 ─────────────────── */
export const TOOL_ICON_SVGS: Record<string, React.ReactNode> = {
  // Git 类
  git_status: <GitBranchIcon />,
  git_init: <GitInitIcon />,
  git_commit: <GitCommitIcon />,
  git_switch_branch: <GitSwitchIcon />,
  git_push: <GitPushIcon />,
  git_revert: <GitRevertIcon />,
  git_diff: <GitDiffIcon />,
  git_log: <GitLogIcon />,
  // 代码 / 编辑类
  search_code: <SearchCodeIcon />,
  search_text: <SearchTextIcon />,
  lsp: <LspIcon />,
  apply_patch: <ApplyPatchIcon />,
  str_replace: <StrReplaceIcon />,
  ast_grep_search: <AstGrepSearchIcon />,
  ast_grep_replace: <AstGrepReplaceIcon />,
  run_shell: <RunShellIcon />,
  run_verification: <RunVerificationIcon />,
  execute_code: <ExecuteCodeIcon />,
  // 文件 / 文档类
  read_file: <ReadFileIcon />,
  write_file: <WriteFileIcon />,
  list_dir: <ListDirIcon />,
  write_markdown: <WriteMarkdownIcon />,
  write_excel: <WriteExcelIcon />,
  write_word: <WriteWordIcon />,
  write_pdf: <WritePdfIcon />,
  // 记忆类
  user_memory: <UserMemoryIcon />,
  read_memory: <ReadMemoryIcon />,
  write_memory: <WriteMemoryIcon />,
  recall_history: <RecallHistoryIcon />,
  imported_docs: <ImportedDocsIcon />,
  // 网络 / 通讯类
  web_search: <WebSearchIcon />,
  fetch_url: <FetchUrlIcon />,
  translate: <TranslateIcon />,
  exchange_rate: <ExchangeRateIcon />,
  weather: <WeatherIcon />,
  send_email: <SendEmailIcon />,
  install_mcp_server: <InstallMcpIcon />,
  // 音乐类
  music_search: <MusicSearchIcon />,
  music_play_track: <MusicPlayTrackIcon />,
  music_play_playlist: <MusicPlayPlaylistIcon />,
  music_get_playback_status: <MusicStatusIcon />,
  music_stop_playback: <MusicStopIcon />,
  music_my_playlists: <MusicPlaylistsIcon />,
  music_playlist_detail: <MusicPlaylistDetailIcon />,
  music_create_playlist: <MusicCreatePlaylistIcon />,
  music_add_to_playlist: <MusicAddToPlaylistIcon />,
  music_toggle_favorite: <MusicFavoriteIcon />,
  music_remove_from_playlist: <MusicRemoveFromPlaylistIcon />,
  music_get_daily_recommendations: <MusicDailyIcon />,
  music_my_subscriptions: <MusicSubscriptionsIcon />,
  music_get_cached_tracks: <MusicCachedIcon />,
  music_remove_cached_track: <MusicRemoveCachedIcon />,
  // 日程 / 动作类
  schedule_task: <ScheduleTaskIcon />,
  plan_trip: <PlanTripIcon />,
  play_live2d_action: <PlayLive2dIcon />,
  // 财务类
  record_expense: <RecordExpenseIcon />,
  query_expense: <QueryExpenseIcon />,
  // 技能类
  invoke_skill: <InvokeSkillIcon />,
  read_skill_reference: <ReadSkillRefIcon />,
  skill_list: <SkillListIcon />,
  skill_view: <SkillViewIcon />,
  skill_manage: <SkillManageIcon />,
  skill_curator: <SkillCuratorIcon />,
  recommend_skill: <RecommendSkillIcon />,
};
