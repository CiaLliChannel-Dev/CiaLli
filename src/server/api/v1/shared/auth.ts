import type { APIContext } from "astro";

import type { JsonObject } from "@/types/json";
import { getAppAccessContext } from "@/server/auth/acl";
import { fail } from "@/server/api/response";
import { getSessionUser } from "@/server/auth/session";

import type { AppAccess } from "./types";

export async function requireAccess(context: APIContext): Promise<
    | {
          access: AppAccess;
      }
    | {
          response: Response;
      }
> {
    const user = await getSessionUser(context);
    if (!user) {
        return { response: fail("未登录", 401) };
    }

    try {
        const access = await getAppAccessContext(user);
        return { access };
    } catch (error) {
        void error;
        return { response: fail("权限不足", 403) };
    }
}

export async function requireAdmin(context: APIContext): Promise<
    | {
          access: AppAccess;
      }
    | {
          response: Response;
      }
> {
    const required = await requireAccess(context);
    if ("response" in required) {
        return required;
    }
    if (!required.access.isAdmin) {
        return { response: fail("需要管理员权限", 403) };
    }
    return required;
}

export function filterPublicStatus(): JsonObject {
    return {
        status: { _eq: "published" },
        is_public: { _eq: true },
    };
}
