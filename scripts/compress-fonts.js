import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import subsetFont from "subset-font";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 读取配置文件获取语言设置和字体配置
async function getConfig() {
    const configPath = path.join(__dirname, "../src/config.ts");
    const configContent = fs.readFileSync(configPath, "utf-8");

    // 提取语言设置
    const langMatch = configContent.match(/lang:\s*["']([^"']+)["']/);
    const lang = langMatch ? langMatch[1] : "zh_CN";

    // 提取字体配置
    const fontConfigMatch = configContent.match(
        /font:\s*\{([\s\S]*?)\n\s*\},\n\s*pageScaling:/,
    );
    if (!fontConfigMatch) {
        console.log("⚠ Font config not found, using default settings");
        return { lang, fonts: [] };
    }

    const fontConfigStr = fontConfigMatch[1];
    const fonts = [];

    // 解析每个字体类别（asciiFont, cjkFont）
    const fontTypes = ["asciiFont", "cjkFont"];

    for (const fontType of fontTypes) {
        const regex = new RegExp(`${fontType}:\\s*\\{([\\s\\S]*?)\\}`, "m");
        const match = fontConfigStr.match(regex);

        if (match) {
            const fontConfig = match[1];

            // 提取 enableCompress
            const compressMatch = fontConfig.match(
                /enableCompress:\s*(true|false)/,
            );
            const enableCompress = compressMatch
                ? compressMatch[1] === "true"
                : false;

            // 提取 localFonts 数组
            const localFontsMatch = fontConfig.match(
                /localFonts:\s*\[(.*?)\]/s,
            );
            let localFonts = [];

            if (localFontsMatch?.[1].trim()) {
                // 提取数组中的字符串
                const fontsStr = localFontsMatch[1];
                localFonts =
                    fontsStr
                        .match(/["']([^"']+)["']/g)
                        ?.map((s) => s.replace(/["']/g, "")) || [];
            }

            if (enableCompress && localFonts.length > 0) {
                fonts.push({
                    type: fontType,
                    files: localFonts,
                    enableCompress,
                });
            }
        }
    }

    return { lang, fonts };
}

// 递归读取目录下所有文件
function readFilesRecursively(dir, fileList = []) {
    const files = fs.readdirSync(dir);

    files.forEach((file) => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);

        if (stat.isDirectory()) {
            readFilesRecursively(filePath, fileList);
        } else {
            fileList.push(filePath);
        }
    });

    return fileList;
}

// 提取文本内容
function extractText(content, ext) {
    let text = content;
    let frontmatterText = "";

    // 提取并处理 frontmatter 中的文本
    if (ext === ".md" || ext === ".mdx") {
        const frontmatterMatch = content.match(/^---[\s\S]*?---/m);
        if (frontmatterMatch) {
            const frontmatter = frontmatterMatch[0];

            // 提取 frontmatter 中的字符串值（包括有引号和无引号的）
            // 匹配 key: value 格式（无引号）
            const unquotedMatches = frontmatter.match(
                /^\s*\w+:\s*([^'"\n]+)$/gm,
            );
            if (unquotedMatches) {
                unquotedMatches.forEach((match) => {
                    const value = match.replace(/^\s*\w+:\s*/, "").trim();
                    // 排除布尔值、日期、数字等非文本内容
                    if (!value.match(/^(true|false|\d{4}-\d{2}-\d{2}|\d+)$/)) {
                        frontmatterText += `${value} `;
                    }
                });
            }

            // 提取带引号的字符串值
            const quotedMatches = frontmatter.match(/:\s*['"]([^'"]+)['"]/g);
            if (quotedMatches) {
                quotedMatches.forEach((match) => {
                    const value = match.replace(/:\s*['"]([^'"]+)['"]/, "$1");
                    frontmatterText += `${value} `;
                });
            }

            // 提取列表项中的文本（如 tags 列表）
            const listMatches = frontmatter.match(/^\s*-\s*([^\n]+)$/gm);
            if (listMatches) {
                listMatches.forEach((match) => {
                    const value = match.replace(/^\s*-\s*/, "").trim();
                    frontmatterText += `${value} `;
                });
            }
        }

        // 移除 frontmatter 后继续处理正文
        text = text.replace(/^---[\s\S]*?---\s*/m, "");

        // 移除代码块中的内容（通常不需要特殊字体）
        text = text.replace(/```[\s\S]*?```/g, "");
        text = text.replace(/`[^`]+`/g, "");
    }

    // 移除 HTML 标签
    text = text.replace(/<[^>]*>/g, " ");

    // 移除 Markdown 语法
    text = text.replace(/[#*_~`[\]()]/g, " ");

    // 移除 URL
    text = text.replace(/https?:\/\/[^\s]+/g, "");

    // 移除多余的空白字符
    text = text.replace(/\s+/g, " ").trim();

    // 合并 frontmatter 文本和正文
    return `${frontmatterText} ${text}`.trim();
}

// 获取 ASCII 字符集（用于 asciiFont）
function getAsciiCharset() {
    const chars = new Set();

    // 基本 ASCII 字符：空格到波浪号 (32-126)
    for (let i = 32; i <= 126; i++) {
        chars.add(String.fromCharCode(i));
    }

    // 常用符号和标点
    const common = " !\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";
    for (const char of common) {
        chars.add(char);
    }

    // 数字
    for (let i = 0; i <= 9; i++) {
        chars.add(String(i));
    }

    // 英文字母
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    for (const char of alphabet) {
        chars.add(char);
    }

    return Array.from(chars).sort().join("");
}

// 获取 Meting API 歌单数据中的文字
async function fetchMetingPlaylistText() {
    try {
        // 读取配置文件获取音乐播放器配置
        const configPath = path.join(__dirname, "../src/config.ts");
        const configContent = fs.readFileSync(configPath, "utf-8");

        // 检查音乐播放器是否启用
        const enableMatch = configContent.match(
            /musicPlayerConfig:\s*MusicPlayerConfig\s*=\s*\{[\s\S]*?enable:\s*(true|false)/,
        );
        if (!enableMatch || enableMatch[1] === "false") {
            console.log(
                "ℹ Music player disabled, skipping Meting API text collection",
            );
            return new Set();
        }

        // 提取音乐播放器配置（使用默认值，因为配置可能不完整）
        // 在实际的音乐播放器组件中，如果配置中没有指定模式，默认使用 "meting"
        const musicConfigMatch = configContent.match(
            /musicPlayerConfig:\s*MusicPlayerConfig\s*=\s*\{([\s\S]*?)\}/,
        );
        let mode = "meting"; // 默认模式
        let meting_api =
            "https://www.bilibili.uno/api?server=:server&type=:type&id=:id&auth=:auth&r=:r";
        let meting_id = "14164869977";
        let meting_server = "netease";
        let meting_type = "playlist";

        if (musicConfigMatch) {
            const configStr = musicConfigMatch[1];

            const modeMatch = configStr.match(/mode:\s*["']([^"']+)["']/);
            if (modeMatch) {
                mode = modeMatch[1];
            }

            const apiMatch = configStr.match(/meting_api:\s*["']([^"']+)["']/);
            if (apiMatch) {
                meting_api = apiMatch[1];
            }

            const idMatch = configStr.match(/id:\s*["']([^"']+)["']/);
            if (idMatch) {
                meting_id = idMatch[1];
            }

            const serverMatch = configStr.match(/server:\s*["']([^"']+)["']/);
            if (serverMatch) {
                meting_server = serverMatch[1];
            }

            const typeMatch = configStr.match(/type:\s*["']([^"']+)["']/);
            if (typeMatch) {
                meting_type = typeMatch[1];
            }
        }

        if (mode !== "meting") {
            console.log(
                'ℹ Music player mode is not "meting", skipping API text collection',
            );
            return new Set();
        }

        // 构建 API URL
        const apiUrl = meting_api
            .replace(":server", meting_server)
            .replace(":type", meting_type)
            .replace(":id", meting_id)
            .replace(":auth", "")
            .replace(":r", Date.now().toString());

        console.log("ℹ Fetching music playlist from Meting API...");
        console.log(`  URL: ${apiUrl}`);

        // 设置请求超时
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超时

        const textSet = new Set();

        try {
            const response = await fetch(apiUrl, {
                signal: controller.signal,
                headers: {
                    "User-Agent":
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                },
            });
            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(
                    `HTTP ${response.status}: ${response.statusText}`,
                );
            }

            const playlist = await response.json();

            if (!Array.isArray(playlist)) {
                throw new Error("API response is not an array");
            }

            console.log(
                `✓ Successfully fetched ${playlist.length} songs from Meting API`,
            );

            // 提取歌曲信息中的文字
            let songCount = 0;
            playlist.forEach((song) => {
                const title = song.name ?? song.title ?? "";
                const artist = song.artist ?? song.author ?? "";

                // 只处理有效的歌曲信息
                if (title.trim() || artist.trim()) {
                    songCount++;

                    // 添加歌名中的字符
                    for (const char of title) {
                        textSet.add(char);
                    }

                    // 添加歌手名中的字符
                    for (const char of artist) {
                        textSet.add(char);
                    }
                }
            });
            if (songCount === 0) {
                console.log("⚠ No valid song data found in API response");
            }
        } catch (fetchError) {
            clearTimeout(timeoutId);

            if (fetchError.name === "AbortError") {
                console.log(
                    "⚠ Meting API request timeout (10s), skipping music text collection",
                );
            } else {
                console.log(
                    `⚠ Failed to fetch Meting API data: ${fetchError.message}, skipping music text collection`,
                );
            }
        }

        return textSet;
    } catch (error) {
        console.log(
            `⚠ Error processing Meting API config: ${error.message}, skipping music text collection`,
        );
        return new Set();
    }
}

const STRING_LITERAL_PATTERNS = [
    /"([^"\\]|\\.|\\n|\\t)*"/g,
    /'([^'\\]|\\.|\\n|\\t)*'/g,
    /`([^`\\]|\\.|\\n|\\t)*`/g,
];

function collectCharsFromStringLiterals(content, textSet) {
    STRING_LITERAL_PATTERNS.forEach((pattern) => {
        const matches = content.match(pattern);
        if (!matches) {
            return;
        }
        matches.forEach((match) => {
            let text = match;
            if (
                (text.startsWith('"') && text.endsWith('"')) ||
                (text.startsWith("'") && text.endsWith("'")) ||
                (text.startsWith("`") && text.endsWith("`"))
            ) {
                text = text.slice(1, -1);
            }
            text = text
                .replace(/\\n/g, "\n")
                .replace(/\\t/g, "\t")
                .replace(/\\"/g, '"')
                .replace(/\\'/g, "'");

            for (const char of text) {
                textSet.add(char);
            }
        });
    });

    const simpleMatches = content.match(/["'`]([^"'`]+)["'`]/g);
    if (!simpleMatches) {
        return;
    }
    simpleMatches.forEach((match) => {
        const text = match.slice(1, -1);
        for (const char of text) {
            textSet.add(char);
        }
    });
}

// 收集所有使用的文字（用于 CJK 字体）
async function collectText() {
    const { lang } = await getConfig();

    const textSet = new Set();

    // 1. 读取 src/config.ts 文件
    const configFile = path.join(__dirname, "../src/config.ts");
    if (fs.existsSync(configFile)) {
        const content = fs.readFileSync(configFile, "utf-8");
        collectCharsFromStringLiterals(content, textSet);
    }

    // 2. 读取对应语言的 i18n 文件
    const i18nFile = path.join(__dirname, `../src/i18n/languages/${lang}.ts`);
    if (fs.existsSync(i18nFile)) {
        const content = fs.readFileSync(i18nFile, "utf-8");
        collectCharsFromStringLiterals(content, textSet);
    }

    // 3. 读取 content 目录
    const contentDir = path.join(__dirname, "../src/content");

    // 检查目录是否存在
    if (!fs.existsSync(contentDir)) {
        console.log(`⚠ Content directory does not exist: ${contentDir}`);
        console.log("  Skipping content text collection");
    } else {
        const contentFiles = readFilesRecursively(contentDir);

        contentFiles.forEach((file) => {
            const ext = path.extname(file);
            if ([".md", ".mdx", ".ts", ".js"].includes(ext)) {
                const content = fs.readFileSync(file, "utf-8");
                const text = extractText(content, ext);
                for (const char of text) {
                    // 只保留中文、日文、韩文等 CJK 字符和常用标点
                    if (
                        char.match(
                            /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af\u3000-\u303f\uff00-\uffef]/,
                        )
                    ) {
                        textSet.add(char);
                    }
                }
            }
        });
    }

    // 添加常用标点符号和数字
    const commonChars = "0123456789，。！？；：\"\"''（）【】《》、·—…「」『』";
    for (const char of commonChars) {
        textSet.add(char);
    }

    // 添加英文字母（如果字体支持）
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    for (const char of alphabet) {
        textSet.add(char);
    }

    // 4. 从 Meting API 获取歌单数据中的文字
    const metingTextSet = await fetchMetingPlaylistText();

    // 将 Meting API 的文字添加到主文字集合中
    for (const char of metingTextSet) {
        textSet.add(char);
    }

    if (metingTextSet.size > 0) {
        console.log(
            `✓ Added ${metingTextSet.size} unique characters from music playlist`,
        );
    }

    // 漏网之鱼（如散落在各处未纳入统计的UI文本等）
    const otherWords = ["示例", "歌曲", "艺术家"];

    for (const term of otherWords) {
        for (const char of term) {
            textSet.add(char);
        }
    }

    return Array.from(textSet).sort().join("");
}

// 压缩字体并输出到 dist 目录
async function compressFonts() {
    try {
        // 读取配置
        const { fonts } = await getConfig();

        if (fonts.length === 0) {
            console.log(
                "⚠ No fonts to compress (enableCompress=false or localFonts is empty)",
            );
            return;
        }

        console.log(`Found ${fonts.length} font configs to compress`);

        // 检查 dist 目录是否存在
        const distDir = path.join(__dirname, "../dist");
        if (!fs.existsSync(distDir)) {
            console.log(
                "⚠ dist directory does not exist, please run astro build first",
            );
            return;
        }

        // 创建 dist/assets/font 目录
        const distFontDir = path.join(distDir, "assets/font");
        if (!fs.existsSync(distFontDir)) {
            fs.mkdirSync(distFontDir, { recursive: true });
        }

        // 根据字体类型收集不同的字符集
        const cjkText = await collectText(); // CJK 字体使用完整字符集
        const asciiText = getAsciiCharset(); // ASCII 字体只使用 ASCII 字符集

        console.log("Starting font compression...");

        let totalOriginalSize = 0;
        let totalCompressedSize = 0;
        let processedCount = 0;

        // 用于收集所有错误
        const errors = [];

        // 遍历所有需要压缩的字体
        for (const fontConfig of fonts) {
            // 根据字体类型选择字符集
            const text = fontConfig.type === "asciiFont" ? asciiText : cjkText;

            for (const fontFile of fontConfig.files) {
                const fontSrc = path.join(
                    __dirname,
                    "../public/assets/font",
                    fontFile,
                );
                const ext = path.extname(fontFile).toLowerCase();
                const baseName = path.basename(fontFile, ext);

                if (!fs.existsSync(fontSrc)) {
                    const errorMsg = `❌ Config error [${fontConfig.type}]: Font file does not exist   In config: "${fontFile}"\n   Expected path: public/assets/font/${fontFile}\n   \n   Please check:\n   1. Is the filename correct (case sensitive)?\n   2. Is the file in public/assets/font/?\n   3. Is ${fontConfig.type}.localFonts in src/config.ts correct?`;

                    errors.push(errorMsg);
                    console.log(`\n${errorMsg}\n`);
                    continue;
                }

                const originalSize = fs.statSync(fontSrc).size;
                totalOriginalSize += originalSize;

                // 根据文件类型决定处理方式
                if (ext === ".woff2" || ext === ".woff") {
                    // woff/woff2 已经是 Web 优化格式，不支持进一步子集化压缩
                    console.log(
                        `⚠ Skipping ${fontFile} (already web-optimized format)`,
                    );

                    // 直接复制到 dist
                    const destFile = path.join(distFontDir, fontFile);
                    fs.copyFileSync(fontSrc, destFile);
                    totalCompressedSize += originalSize;
                    // 不计入处理数量
                } else if (ext === ".ttf" || ext === ".otf") {
                    // TTF/OTF 需要压缩为 woff2
                    console.log(`Compressing ${fontFile}...`);
                    const fontBuffer = fs.readFileSync(fontSrc);
                    const subsetBuffer = await subsetFont(fontBuffer, text, {
                        targetFormat: "woff2",
                    });

                    // 检查压缩结果
                    const compressedFile = path.join(
                        distFontDir,
                        `${baseName}.woff2`,
                    );
                    fs.writeFileSync(compressedFile, subsetBuffer);

                    if (fs.existsSync(compressedFile)) {
                        const compressedSize = fs.statSync(compressedFile).size;
                        totalCompressedSize += compressedSize;
                        const reduction = (
                            (1 - compressedSize / originalSize) *
                            100
                        ).toFixed(2);

                        console.log(
                            `✓ ${fontFile} → ${baseName}.woff2 (${(compressedSize / 1024).toFixed(2)} KB, reduced ${reduction}%)`,
                        );
                        processedCount++;
                    }
                } else {
                    console.log(
                        `⚠ Unsupported font format, skipping: ${fontFile}`,
                    );
                }
            }
        }

        // 输出总结
        if (errors.length > 0) {
            console.log("\n❌ Font compression encountered errors!");
            console.log(`${errors.length} errors, please fix and retry.\n`);

            // 列出实际存在的字体文件
            const fontDir = path.join(__dirname, "../public/assets/font");
            if (fs.existsSync(fontDir)) {
                const actualFiles = fs
                    .readdirSync(fontDir)
                    .filter((f) =>
                        [".ttf", ".otf", ".woff", ".woff2"].includes(
                            path.extname(f).toLowerCase(),
                        ),
                    );

                if (actualFiles.length > 0) {
                    console.log("Available font files:");
                    actualFiles.forEach((f) => console.log(`  - ${f}`));
                } else {
                    console.log("  (font directory is empty)");
                }
            }

            process.exit(1);
        }

        if (processedCount > 0) {
            const totalReduction = (
                (1 - totalCompressedSize / totalOriginalSize) *
                100
            ).toFixed(2);
            console.log("\n✓ Font optimization complete!");
            console.log(
                `  Files processed: ${processedCount}, Overall reduction: ${totalReduction}%`,
            );
        } else {
            console.log("\n⚠ No font files processed");
        }
    } catch (error) {
        console.error("❌ Font compression failed:", error);
        process.exit(1);
    }
}

// 运行压缩
void compressFonts();
