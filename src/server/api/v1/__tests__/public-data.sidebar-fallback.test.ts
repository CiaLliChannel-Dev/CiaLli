import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockProfileView } from "@/__tests__/helpers/mock-data";

vi.mock("@/server/cache/manager", () => ({
    cacheManager: {
        get: vi.fn(),
        set: vi.fn(),
        invalidate: vi.fn(),
    },
}));

vi.mock("@/server/bangumi/service", () => ({
    loadBangumiCollections: vi.fn(),
}));

vi.mock(
    "@/server/repositories/public/public-data.repository",
    async (importOriginal) => {
        const actual =
            await importOriginal<
                typeof import("@/server/repositories/public/public-data.repository")
            >();
        return {
            ...actual,
            fetchDiaryCommentCountMapFromRepository: vi.fn(),
            fetchDiaryLikeCountMapFromRepository: vi.fn(),
            listHomeAlbumsFromRepository: vi.fn(),
            listHomeArticlesFromRepository: vi.fn(),
            listHomeDiariesFromRepository: vi.fn(),
            loadAdministratorSidebarFallbackSourceFromRepository: vi.fn(),
            loadProfileViewByFilterFromRepository: vi.fn(),
        };
    },
);

vi.mock("@/server/directus-auth", async (importOriginal) => {
    const actual =
        await importOriginal<typeof import("@/server/directus-auth")>();
    return {
        ...actual,
        buildPublicAssetUrl: vi.fn((fileId: string) => `asset:${fileId}`),
    };
});

import { cacheManager } from "@/server/cache/manager";
import {
    loadAdministratorSidebarFallbackSourceFromRepository,
    loadProfileViewByFilterFromRepository,
} from "@/server/repositories/public/public-data.repository";
import { loadOfficialSidebarProfile } from "@/server/api/v1/public-data-helpers";

const mockedCacheManager = vi.mocked(cacheManager);
const mockedLoadAdministratorSidebarFallbackSourceFromRepository = vi.mocked(
    loadAdministratorSidebarFallbackSourceFromRepository,
);
const mockedLoadProfileViewByFilterFromRepository = vi.mocked(
    loadProfileViewByFilterFromRepository,
);

describe("public-data sidebar fallback", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockedCacheManager.get.mockResolvedValue(null);
        mockedCacheManager.set.mockResolvedValue(undefined);
        mockedLoadAdministratorSidebarFallbackSourceFromRepository.mockResolvedValue(
            null,
        );
        mockedLoadProfileViewByFilterFromRepository.mockResolvedValue(null);
    });

    it("Administrator 有公开 profile 时优先返回公开侧栏资料", async () => {
        mockedLoadAdministratorSidebarFallbackSourceFromRepository.mockResolvedValue(
            {
                profile: mockProfileView({
                    user_id: "admin-1",
                    username: "founder",
                    display_name: "Founder",
                    bio: "公开资料",
                    avatar_file: "avatar-profile",
                    social_links: [
                        {
                            platform: "github",
                            url: "https://example.com/founder",
                            enabled: true,
                        },
                    ],
                }),
            },
        );

        const result = await loadOfficialSidebarProfile();

        expect(result).toEqual({
            display_name: "Founder",
            bio: "公开资料",
            avatar_url: "asset:avatar-profile",
            username: "founder",
            social_links: [
                {
                    platform: "github",
                    url: "https://example.com/founder",
                    enabled: true,
                },
            ],
            is_official: false,
        });
        expect(
            mockedLoadProfileViewByFilterFromRepository,
        ).not.toHaveBeenCalled();
    });

    it("Administrator 没有公开 profile 时回退到官方公开档案", async () => {
        mockedLoadAdministratorSidebarFallbackSourceFromRepository.mockResolvedValue(
            null,
        );
        mockedLoadProfileViewByFilterFromRepository.mockResolvedValue(
            mockProfileView({
                username: "official",
                display_name: "Official",
                bio: "官方账户",
                avatar_file: "avatar-official",
                is_official: true,
            }),
        );

        const result = await loadOfficialSidebarProfile();

        expect(result).toEqual({
            display_name: "Official",
            bio: "官方账户",
            avatar_url: "asset:avatar-official",
            username: "official",
            social_links: null,
            is_official: true,
        });
    });

    it("没有 Administrator 时回退到官方公开档案", async () => {
        mockedLoadProfileViewByFilterFromRepository.mockResolvedValue(
            mockProfileView({
                username: "official",
                display_name: "Official",
                bio: "官方账户",
                avatar_file: "avatar-official",
                is_official: true,
            }),
        );

        const result = await loadOfficialSidebarProfile();

        expect(result).toEqual({
            display_name: "Official",
            bio: "官方账户",
            avatar_url: "asset:avatar-official",
            username: "official",
            social_links: null,
            is_official: true,
        });
    });

    it("没有 Administrator 且没有官方公开档案时返回字面量兜底", async () => {
        const result = await loadOfficialSidebarProfile();

        expect(result).toEqual({
            display_name: "CiaLli",
            bio: null,
            avatar_url: null,
            username: null,
            social_links: null,
            is_official: true,
        });
    });
});
