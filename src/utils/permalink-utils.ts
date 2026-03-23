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

/**
 * 判断文章是否使用自定义 permalink（根目录下，不在 /posts/ 下）
 * @param post 文章数据
 */
export function hasCustomPermalink(
    post: PermalinkPost | { data: { permalink?: string } },
): boolean {
    return Boolean(post.data.permalink);
}

/**
 * 获取文章的完整 URL 路径
 * @param post 文章数据
 * @returns URL 路径（如 /my-post/ 或 /custom-path/）
 */
export function getPermalinkPath(post: PermalinkPost): string {
    const slug = generatePermalinkSlug(post);

    // 所有 permalink 生成的链接都在根目录下
    return `/${slug}`;
}
