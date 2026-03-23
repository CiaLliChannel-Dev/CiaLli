import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const sourceRoot = path.resolve(process.cwd(), "src");

const rules = [
    {
        name: "旧桌面端阻断组件",
        regex: /\bDesktopOnlyNotice\b|\bdesktop-only-notice\b/gm,
    },
    {
        name: "旧桌面端数据属性",
        regex: /\bdata-desktop-(?:unsupported|force-browse)\b|\bdata-desktop-app\b/gm,
    },
    {
        name: "旧首页桌面态类名",
        regex: /\blg:is-home\b/gm,
    },
    {
        name: "旧桌面强制浏览状态",
        regex: /\bcialli\.desktop\.force-browse\b|\bdesktop-force-browse-change\b/gm,
    },
    {
        name: "旧桌面折叠阈值配置",
        regex: /\bdesktopCollapseMinWidth\b|\bviewportWidth\s*>=\s*1280\b/gm,
    },
    {
        name: "旧桌面端最小宽度常量",
        regex: /\bDESKTOP_MIN_WIDTH\b/gm,
    },
];

async function walkFiles(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const targetPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...(await walkFiles(targetPath)));
            continue;
        }
        files.push(targetPath);
    }
    return files;
}

function getLineColumn(content, index) {
    const upToIndex = content.slice(0, index);
    const lines = upToIndex.split("\n");
    const line = lines.length;
    const column = lines[lines.length - 1].length + 1;
    return { line, column };
}

function collectMatches(content, regex) {
    const matches = [];
    regex.lastIndex = 0;
    for (const match of content.matchAll(regex)) {
        if (typeof match.index !== "number") {
            continue;
        }
        matches.push({ index: match.index, value: match[0] });
    }
    return matches;
}

const files = await walkFiles(sourceRoot);
const violations = [];

for (const filePath of files) {
    const content = await readFile(filePath, "utf-8");
    for (const rule of rules) {
        const matches = collectMatches(content, rule.regex);
        for (const match of matches) {
            const { line, column } = getLineColumn(content, match.index);
            violations.push({
                filePath,
                line,
                column,
                rule: rule.name,
                snippet: match.value.trim(),
            });
        }
    }
}

if (violations.length === 0) {
    console.log("[responsive-layout-check] passed");
    process.exit(0);
}

console.error("[responsive-layout-check] found legacy desktop-only remnants:");
for (const violation of violations) {
    const relativePath = path.relative(process.cwd(), violation.filePath);
    console.error(
        `- ${relativePath}:${violation.line}:${violation.column} [${violation.rule}] ${violation.snippet}`,
    );
}
process.exit(1);
