/**
 * 客户端 CSRF Token 读取工具
 *
 * 从 document.cookie 中提取 cialli_csrf 值，
 * 用于在写请求中附加 x-csrf-token header。
 */
export function getCsrfToken(): string {
    const m = document.cookie.match(/(?:^|;\s*)cialli_csrf=([^;]*)/);
    return m ? decodeURIComponent(m[1]) : "";
}
