import { removeFileExtension } from "./url-utils";

export type PermalinkPost = {
    id: string;
    data: {
        alias?: string;
        permalink?: string;
    };
};

/**
 * 生成 permalink slug
 * 按既定优先级收敛为：custom permalink -> alias -> 默认 slug
 * @param post 文章数据
 * @returns 生成的 slug（不包含 /posts/ 前缀）
 */
export function generatePermalinkSlug(post: PermalinkPost): string {
    // 如果文章有自定义 permalink，优先使用（不在 /posts/ 下）
    if (post.data.permalink) {
        // 移除开头和结尾的斜杠
        return post.data.permalink.replace(/^\/+/, "").replace(/\/+$/, "");
    }

    if (post.data.alias) {
        return post.data.alias.replace(/^\/+/, "").replace(/\/+$/, "");
    }

    return removeFileExtension(post.id);
}
