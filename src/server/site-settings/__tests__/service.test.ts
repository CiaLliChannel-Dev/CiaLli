import { describe, expect, it, vi } from "vitest";

import { defaultSiteSettings } from "@/config";

vi.mock("@/server/cache/manager", () => ({
    cacheManager: {
        get: vi.fn(),
        set: vi.fn(),
        invalidate: vi.fn(),
    },
}));

vi.mock("@/server/directus/client", () => ({
    readMany: vi.fn(),
}));

import { resolveSiteSettingsPayload } from "@/server/site-settings/service";

describe("resolveSiteSettingsPayload", () => {
    it("允许将站点时区从 null 更新为显式字符串", () => {
        const base = {
            ...defaultSiteSettings,
            site: {
                ...defaultSiteSettings.site,
                timeZone: null,
            },
        };

        const result = resolveSiteSettingsPayload(
            {
                site: {
                    timeZone: "UTC",
                },
            },
            base,
        );

        expect(result.site.timeZone).toBe("UTC");
    });

    it("允许将站点时区从显式字符串清空为 null", () => {
        const base = {
            ...defaultSiteSettings,
            site: {
                ...defaultSiteSettings.site,
                timeZone: "Asia/Shanghai",
            },
        };

        const result = resolveSiteSettingsPayload(
            {
                site: {
                    timeZone: null,
                },
            },
            base,
        );

        expect(result.site.timeZone).toBeNull();
    });

    it("会将非法时区字符串归一化为 null", () => {
        const result = resolveSiteSettingsPayload({
            site: {
                timeZone: "Mars/Olympus",
            },
        });

        expect(result.site.timeZone).toBeNull();
    });
});
