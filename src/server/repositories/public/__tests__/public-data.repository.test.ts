import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockProfile } from "@/__tests__/helpers/mock-data";
import { DIRECTUS_ROLE_NAME } from "@/server/auth/directus-access";

vi.mock("@/server/directus/client", () => ({
    countItems: vi.fn(),
    countItemsGroupedByField: vi.fn(),
    listDirectusRoles: vi.fn(),
    readMany: vi.fn(),
}));

vi.mock("@/server/repositories/directus/scope", () => ({
    withServiceRepositoryContext: vi.fn(
        async (task: () => Promise<unknown>) => await task(),
    ),
}));

import { listDirectusRoles, readMany } from "@/server/directus/client";
import { loadAdministratorSidebarFallbackSourceFromRepository } from "@/server/repositories/public/public-data.repository";

const mockedListDirectusRoles = vi.mocked(listDirectusRoles);
const mockedReadMany = vi.mocked(readMany);

describe("public-data repository administrator sidebar fallback", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("按最早创建时间查询 Administrator，并拼装公开 profile", async () => {
        mockedListDirectusRoles.mockResolvedValue([
            {
                id: "role-admin",
                name: DIRECTUS_ROLE_NAME.administrator,
                users: ["admin-2", "admin-1"],
            },
        ] as never);
        mockedReadMany
            .mockResolvedValueOnce([
                mockProfile({
                    user_id: "admin-1",
                    username: "founder",
                    display_name: "Founder",
                    social_links: [
                        {
                            platform: "github",
                            url: "https://example.com/founder",
                            enabled: true,
                        },
                    ],
                }),
            ] as never)
            .mockResolvedValueOnce([
                {
                    id: "admin-1",
                    email: "admin@example.com",
                    first_name: "Admin",
                    last_name: "User",
                    description: "system admin",
                    avatar: "avatar-1",
                },
            ] as never);

        const result =
            await loadAdministratorSidebarFallbackSourceFromRepository();

        expect(result).not.toBeNull();
        expect(mockedListDirectusRoles).toHaveBeenCalledTimes(1);
        expect(mockedReadMany).toHaveBeenCalledWith(
            "app_user_profiles",
            expect.objectContaining({
                filter: {
                    _and: [
                        { user_id: { _in: ["admin-2", "admin-1"] } },
                        { profile_public: { _eq: true } },
                        { status: { _eq: "published" } },
                    ],
                },
                limit: 1,
                sort: ["date_created"],
            }),
        );
        expect(mockedReadMany).toHaveBeenNthCalledWith(
            2,
            "directus_users",
            expect.objectContaining({
                filter: { id: { _eq: "admin-1" } },
                limit: 1,
                fields: [
                    "id",
                    "email",
                    "first_name",
                    "last_name",
                    "avatar",
                    "description",
                ],
            }),
        );
        expect(result?.profile?.username).toBe("founder");
        expect(result?.profile?.avatar_file).toBe("avatar-1");
        expect(result?.profile?.bio).toBe("system admin");
    });

    it("Administrator 没有公开 profile 时返回 null", async () => {
        mockedListDirectusRoles.mockResolvedValue([
            {
                id: "role-admin",
                name: DIRECTUS_ROLE_NAME.administrator,
                users: ["admin-2"],
            },
        ] as never);
        mockedReadMany.mockResolvedValue([] as never);

        const result =
            await loadAdministratorSidebarFallbackSourceFromRepository();

        expect(result).toBeNull();
    });
});
