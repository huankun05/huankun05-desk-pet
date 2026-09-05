/**
 * 技能内容安全扫描（移植自 Hermes tools/skills_guard.py 的核心模式）
 *
 * 在 Agent 自动创建技能时，对 SKILL.md 内容做静态正则扫描，拦截危险命令
 * （供应链下载执行、密钥外传、破坏性系统操作等）。这是防御性深度检查，
 * 不是安全边界——技能内容最终仍由模型自行执行。
 */

// 危险模式：pattern_id / 严重级 / 类别 / 描述。
// 移植自 Hermes THREAT_PATTERNS 的 critical 级子集，保留原文正则语义。
interface ThreatPattern {
  id: string;
  category: string;
  description: string;
  /** RegExp，多行模式（m）在扫描时统一启用 */
  source: string;
}

const THREAT_PATTERNS: ThreatPattern[] = [
  // ── 密钥外传：curl/wget 请求体插值密钥环境变量 ──
  {
    id: "env_exfil_curl",
    category: "exfiltration",
    description: "curl 命令插值密钥类环境变量",
    source: String.raw`curl\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)`,
  },
  // ── 供应链：下载并执行 ──
  {
    id: "curl_pipe_shell",
    category: "supply_chain",
    description: "curl 管道到 shell（下载即执行）",
    source: String.raw`curl\s+[^\n]*\|\s*(ba)?sh`,
  },
  {
    id: "wget_pipe_shell",
    category: "supply_chain",
    description: "wget 管道到 shell（下载即执行）",
    source: String.raw`wget\s+[^\n]*\|\s*(ba)?sh`,
  },
  {
    id: "curl_pipe_python",
    category: "supply_chain",
    description: "curl 管道到 Python 解释器",
    source: String.raw`curl\s+[^\n]*\|\s*python`,
  },
  {
    id: "base64_pipe_shell",
    category: "supply_chain",
    description: "base64 解码后管道到 shell 执行",
    source: String.raw`base64\s+[^\n]*-\s*d\s*[^\n]*\|\s*(ba)?sh`,
  },
  // ── 破坏性系统操作 ──
  {
    id: "rm_rf_root",
    category: "destructive",
    description: "递归强制删除根目录或用户目录",
    source: String.raw`rm\s+-\s*rf\s+(/\s*\*?|~|\$HOME|C:\\)`,
  },
  {
    id: "disk_overwrite",
    category: "destructive",
    description: "向块设备/磁盘直接写入",
    source: String.raw`(dd|cat)\s+[^\n]*(/dev/sd|/dev/nvme|/dev/hd)`,
  },
  {
    id: "format_disk",
    category: "destructive",
    description: "格式化磁盘",
    source: String.raw`(mkfs\.\w+|format)\s+[^\n]*(/dev/sd|/dev/nvme)`,
  },
  {
    id: "chmod_777_root",
    category: "destructive",
    description: "对整个根目录递归开放权限",
    source: String.raw`chmod\s+-\s*R\s+777\s+[/\\]`,
  },
  {
    id: "disable_firewall",
    category: "persistence",
    description: "关闭系统防火墙/安全防护",
    source: String.raw`(systemctl\s+stop\s+firewalld|netsh\s+advfirewall\s+set\s+allprofiles\s+state\s+off)`,
  },
];

/** 单条扫描发现 */
export interface SecurityFinding {
  patternId: string;
  category: string;
  description: string;
  line: number;
}

/** 扫描结果 */
export interface SkillSecurityScanResult {
  /** 是否放行 */
  allowed: boolean;
  /** 拦截原因（allowed=false 时给出） */
  reason?: string;
  /** 发现的危险模式列表 */
  findings: SecurityFinding[];
}

/**
 * 扫描技能内容中的危险命令模式。
 *
 * @param content SKILL.md 全文
 * @returns 扫描结果；命中任何危险模式即拦截
 */
export function scanSkillContent(content: string): SkillSecurityScanResult {
  const findings: SecurityFinding[] = [];
  const lines = content.split(/\r?\n/);
  const seen = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const pattern of THREAT_PATTERNS) {
      const regex = new RegExp(pattern.source, "i");
      if (regex.test(line)) {
        const key = `${pattern.id}:${i + 1}`;
        if (seen.has(key)) continue;
        seen.add(key);
        findings.push({ patternId: pattern.id, category: pattern.category, description: pattern.description, line: i + 1 });
      }
    }
  }

  if (findings.length === 0) {
    return { allowed: true, findings };
  }
  const details = findings.map((f) => `  - 第 ${f.line} 行 [${f.category}] ${f.description}`).join("\n");
  return {
    allowed: false,
    reason: `检测到 ${findings.length} 处危险命令模式，技能被拦截：\n${details}`,
    findings,
  };
}
