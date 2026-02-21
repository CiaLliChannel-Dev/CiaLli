import { describe, expect, it } from "vitest";

import { sanitizeMarkdownHtml } from "@/server/markdown/sanitize";

describe("sanitizeMarkdownHtml 样式白名单", () => {
    it("过滤危险布局样式，保留安全文本样式", () => {
        const html = sanitizeMarkdownHtml(
            '<div style="position:fixed;z-index:99999;top:0;left:0;color:red">poc</div>',
        );

        expect(html).not.toContain("position:fixed");
        expect(html).not.toContain("z-index:99999");
        expect(html).not.toContain("top:0");
        expect(html).not.toContain("left:0");
        expect(html).toContain("color:red");
    });

    it("保留白名单内的排版样式", () => {
        const html = sanitizeMarkdownHtml(
            '<p style="font-size:16px;font-weight:700;text-align:center;text-decoration:underline;background-color:#fff">ok</p>',
        );

        expect(html).toContain("font-size:16px");
        expect(html).toContain("font-weight:700");
        expect(html).toContain("text-align:center");
        expect(html).toContain("text-decoration:underline");
        expect(html).toContain("background-color:#fff");
    });

    it("强制 iframe 使用严格 sandbox", () => {
        const html = sanitizeMarkdownHtml(
            '<iframe src="https://example.com/embed" sandbox="allow-scripts"></iframe>',
        );

        expect(html).toContain("<iframe");
        expect(html).toContain("sandbox");
        expect(html).not.toContain("allow-scripts");
    });

    it("移除 img 的 data URI 载荷", () => {
        const html = sanitizeMarkdownHtml(
            '<img src="data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+" alt="x" />',
        );

        expect(html).not.toContain("data:image/svg+xml");
        expect(html).toContain("<img");
    });
});
