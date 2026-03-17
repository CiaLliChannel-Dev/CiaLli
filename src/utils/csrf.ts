/**
 * 客户端 CSRF Token 读取工具
 *
 * 从服务端注入的 <meta name="cialli-csrf-token"> 读取值，
 * 用于在写请求中附加 x-csrf-token header。
 */
export function getCsrfToken(): string {
    const element = document.querySelector('meta[name="cialli-csrf-token"]');
    if (!(element instanceof HTMLMetaElement)) {
        return "";
    }
    return element.content || "";
}
