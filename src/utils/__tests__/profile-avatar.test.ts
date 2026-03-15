import { describe, expect, it } from "vitest";

import { resolveDisplayAvatarUrl } from "../profile-avatar";

describe("resolveDisplayAvatarUrl", () => {
    it("有用户头像时优先返回用户头像", () => {
        expect(
            resolveDisplayAvatarUrl(
                "https://cdn.example.com/avatar.webp",
                "assets/images/avatar.webp",
            ),
        ).toBe("https://cdn.example.com/avatar.webp");
    });

    it("用户头像为空时回退到站点默认头像", () => {
        expect(resolveDisplayAvatarUrl("", "assets/images/avatar.webp")).toBe(
            "assets/images/avatar.webp",
        );
        expect(resolveDisplayAvatarUrl(null, "assets/images/avatar.webp")).toBe(
            "assets/images/avatar.webp",
        );
    });

    it("主头像与回退头像都为空时返回空字符串", () => {
        expect(resolveDisplayAvatarUrl(undefined, "   ")).toBe("");
    });
});
