/**
 * Simplified Chinese — the interpolated sentences of the account and credential pages.
 */
import type { Dict } from "../merge";

export const accountPatterns: Dict = {
  "Device #{}": "设备 #{}",
  "File must be smaller than {} MB.": "文件必须小于 {} MB。",
  "On — OTP is used for: {}": "已开启 — OTP 用于：{}",
  "These flows stop working immediately: {}": "以下流程将立即停止工作：{}",
  "System is under maintenance — you will be signed out in {}s.":
    "系统正在维护 — 您将在 {} 秒后被登出。",

  // -- Runtime sweep: strings the extractor could not see statically ---------
  "{} minute ago": "{} 分钟前",
  "{} minutes ago": "{} 分钟前",
  "{} hour ago": "{} 小时前",
  "{} hours ago": "{} 小时前",
  "{} day ago": "{} 天前",
  "{} days ago": "{} 天前",
  "{} month ago": "{} 个月前",
  "{} months ago": "{} 个月前",
};
