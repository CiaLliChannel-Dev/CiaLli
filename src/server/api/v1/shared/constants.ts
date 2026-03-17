export const DEFAULT_LIST_LIMIT = 20;

export const DIARY_FIELDS = [
    "id",
    "short_id",
    "author_id",
    "status",
    "content",
    "allow_comments",
    "praviate",
    "date_created",
    "date_updated",
] as const;

export const ADMIN_MODULE_COLLECTION = {
    articles: "app_articles",
    diaries: "app_diaries",
    albums: "app_albums",
    "article-comments": "app_article_comments",
    "diary-comments": "app_diary_comments",
} as const;
