/**
 * CSRF 双提交 Token
 *
 * Cookie（httpOnly: false）+ 请求头双重提交校验。
 * 使用 Node.js crypto.timingSafeEqual 做恒时比较。
 */
import { timingSafeEqual } from "node:crypto";

import type { APIContext } from "astro";

import { fail } from "@/server/api/response";

export const CSRF_COOKIE = "cialli_csrf";
export const CSRF_HEADER = "x-csrf-token";

function generateCsrfToken(): string {
    return crypto.randomUUID();
}

function isSecureRequest(url: URL): boolean {
    return url.protocol === "https:";
}

/** 若 cookie 不存在则生成并 set，确保每个页面响应都携带 CSRF cookie */
export function ensureCsrfCookie(context: APIContext): void {
    const existing = context.cookies.get(CSRF_COOKIE)?.value;
    if (existing) return;

    const token = generateCsrfToken();
    context.cookies.set(CSRF_COOKIE, token, {
        httpOnly: false,
        sameSite: "lax",
        secure: isSecureRequest(context.url),
        path: "/",
        maxAge: 86400,
    });
}

/**
 * 校验 CSRF token：比对 cookie 值与 header 值。
 * 不匹配时返回 403 响应，匹配则返回 null。
 */
export function assertCsrfToken(context: APIContext): Response | null {
    const cookieValue = context.cookies.get(CSRF_COOKIE)?.value ?? "";
    const headerValue = context.request.headers.get(CSRF_HEADER) ?? "";

    if (!cookieValue || !headerValue) {
        return fail("CSRF 令牌无效", 403, "CSRF_INVALID");
    }

    // 使用 timingSafeEqual 做恒时比较，防止计时攻击
    const a = Buffer.from(cookieValue, "utf8");
    const b = Buffer.from(headerValue, "utf8");

    if (a.byteLength !== b.byteLength) {
        return fail("CSRF 令牌无效", 403, "CSRF_INVALID");
    }

    if (!timingSafeEqual(a, b)) {
        return fail("CSRF 令牌无效", 403, "CSRF_INVALID");
    }

    return null;
}
