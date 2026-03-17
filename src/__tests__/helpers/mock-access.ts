/**
 * AppAccess mock 工厂
 *
 * 构造 ACL 上下文对象（user + profile + permissions + isAdmin）。
 */

import type { AppAccessContext } from "@/server/auth/acl";

import {
    mockProfile,
    mockPermissions,
    mockSessionUser,
    mockAdminSessionUser,
} from "./mock-data";

export function createMemberAccess(
    overrides: Partial<AppAccessContext> = {},
): AppAccessContext {
    return {
        user: mockSessionUser(),
        profile: mockProfile(),
        permissions: mockPermissions(),
        isAdmin: false,
        ...overrides,
    };
}

export function createAdminAccess(
    overrides: Partial<AppAccessContext> = {},
): AppAccessContext {
    return {
        user: mockAdminSessionUser(),
        profile: mockProfile({
            id: "admin-profile-1",
            user_id: "admin-1",
            username: "admin",
            display_name: "Admin",
        }),
        permissions: mockPermissions({
            id: "admin-perm-1",
            user_id: "admin-1",
            app_role: "admin",
        }),
        isAdmin: true,
        ...overrides,
    };
}
