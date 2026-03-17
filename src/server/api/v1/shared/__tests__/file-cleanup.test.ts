import { describe, it, expect } from "vitest";

import {
    extractDirectusFileIdsFromUnknown,
    normalizeDirectusFileId,
} from "@/server/api/v1/shared/file-cleanup";

describe("normalizeDirectusFileId", () => {
    const VALID_UUID = "a1b2c3d4-e5f6-1234-9abc-def012345678";

    it("string UUID → 返回小写 UUID", () => {
        expect(normalizeDirectusFileId(VALID_UUID)).toBe(VALID_UUID);
    });

    it("大写 UUID → 返回小写", () => {
        expect(normalizeDirectusFileId(VALID_UUID.toUpperCase())).toBe(
            VALID_UUID,
        );
    });

    it("对象含 id → 递归处理", () => {
        expect(normalizeDirectusFileId({ id: VALID_UUID })).toBe(VALID_UUID);
    });

    it("null → null", () => {
        expect(normalizeDirectusFileId(null)).toBe(null);
    });

    it("undefined → null", () => {
        expect(normalizeDirectusFileId(undefined)).toBe(null);
    });

    it("空字符串 → null", () => {
        expect(normalizeDirectusFileId("")).toBe(null);
    });

    it("非 UUID 字符串 → null", () => {
        expect(normalizeDirectusFileId("not-a-uuid")).toBe(null);
    });

    it("数字 → null", () => {
        expect(normalizeDirectusFileId(42)).toBe(null);
    });
});

describe("extractDirectusFileIdsFromUnknown", () => {
    const UUID_A = "a1b2c3d4-e5f6-1234-9abc-def012345678";
    const UUID_B = "f1e2d3c4-b5a6-4234-8abc-fedcba987654";

    it("从字符串中提取多个 UUID", () => {
        expect(
            extractDirectusFileIdsFromUnknown(
                `/api/v1/public/assets/${UUID_A} 和 /assets/${UUID_B}`,
            ),
        ).toEqual([UUID_A, UUID_B]);
    });

    it("支持嵌套对象与数组并去重", () => {
        expect(
            extractDirectusFileIdsFromUnknown({
                body: `![a](/api/v1/public/assets/${UUID_A})`,
                extra: [{ id: UUID_A.toUpperCase() }, { file: UUID_B }],
            }),
        ).toEqual([UUID_A, UUID_B]);
    });

    it("无 UUID 时返回空数组", () => {
        expect(
            extractDirectusFileIdsFromUnknown({
                body: "无文件",
                items: [123, false, null],
            }),
        ).toEqual([]);
    });
});
