import { describe, expect, it } from "vitest";

import { canCreateReplyAtDepth } from "@/server/api/v1/comments";

describe("canCreateReplyAtDepth", () => {
    it("父级深度为 0 时允许回复", () => {
        expect(canCreateReplyAtDepth(0)).toBe(true);
    });

    it("父级深度为 1 时允许回复", () => {
        expect(canCreateReplyAtDepth(1)).toBe(true);
    });

    it("父级深度为 2 时禁止回复", () => {
        expect(canCreateReplyAtDepth(2)).toBe(false);
    });

    it("父级深度大于 2 时禁止回复", () => {
        expect(canCreateReplyAtDepth(3)).toBe(false);
    });
});
