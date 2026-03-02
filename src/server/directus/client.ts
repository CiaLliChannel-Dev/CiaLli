import {
    aggregate,
    createDirectus,
    createItem,
    createUser,
    customEndpoint,
    deleteFile,
    deleteItem,
    readItem,
    readItems,
    readFiles,
    readUser,
    readUsers,
    rest,
    staticToken,
    updateItem,
    updateFile,
    updateUser,
    uploadFiles,
} from "@directus/sdk";

import type { AppUser } from "@/types/app";
import type { JsonObject } from "@/types/json";
import { internal } from "@/server/api/errors";
import { getDirectusUrl } from "@/server/directus-auth";
import {
    toDirectusError,
    isDirectusItemNotFound,
} from "@/server/directus/client-errors";
import type { DirectusSchema } from "./schema";

type DirectusQuery = {
    filter?: JsonObject;
    sort?: string[];
    limit?: number;
    offset?: number;
    fields?: string[];
    search?: string;
    deep?: JsonObject;
};

type DirectusAssetQuery = Partial<
    Record<"width" | "height" | "fit" | "quality" | "format", string>
>;

const SAFE_DIARY_FIELDS = [
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

function getStaticToken(): string {
    const token =
        process.env.DIRECTUS_STATIC_TOKEN ||
        import.meta.env.DIRECTUS_STATIC_TOKEN;
    if (!token || !token.trim()) {
        throw internal("DIRECTUS_STATIC_TOKEN 未配置");
    }
    return token.trim();
}

// 数据请求超时（毫秒）— 需兼容文件上传等较重操作，设为 30 秒
const DATA_FETCH_TIMEOUT_MS = 30_000;

// 提取构建逻辑，让 TypeScript 推断包含 rest() 扩展（.request() 方法）的完整类型
function buildDirectusClient() {
    return createDirectus<DirectusSchema>(getDirectusUrl())
        .with(staticToken(getStaticToken()))
        .with(
            rest({
                onRequest: (options) => ({
                    ...options,
                    signal: AbortSignal.timeout(DATA_FETCH_TIMEOUT_MS),
                }),
            }),
        );
}

let clientSingleton: ReturnType<typeof buildDirectusClient> | null = null;

function getDirectusClient() {
    if (clientSingleton) return clientSingleton;
    clientSingleton = buildDirectusClient();
    console.info("[directus/client] 客户端初始化");
    return clientSingleton;
}

async function runDirectusRequest<T>(
    action: string,
    request: () => Promise<T>,
): Promise<T> {
    try {
        return await request();
    } catch (error) {
        throw toDirectusError(action, error);
    }
}

function assertNonSystemCollection(collection: keyof DirectusSchema): void {
    if (collection === "directus_users" || collection === "directus_files") {
        throw internal(
            `请勿使用通用 items 接口写入系统集合: ${String(collection)}`,
        );
    }
}

export async function readMany<K extends keyof DirectusSchema>(
    collection: K,
    query?: DirectusQuery,
): Promise<DirectusSchema[K]> {
    if (collection === "directus_users") {
        return (await runDirectusRequest("读取用户列表", async () => {
            return await getDirectusClient().request(readUsers(query as never));
        })) as DirectusSchema[K];
    }
    if (collection === "directus_files") {
        return (await runDirectusRequest("读取文件列表", async () => {
            return await getDirectusClient().request(readFiles(query as never));
        })) as DirectusSchema[K];
    }

    return (await runDirectusRequest(
        `读取集合 ${String(collection)} 列表`,
        async () => {
            return await getDirectusClient().request(
                readItems(
                    collection as Exclude<
                        K,
                        "directus_users" | "directus_files"
                    >,
                    query as never,
                ),
            );
        },
    )) as DirectusSchema[K];
}

export async function readOneById<K extends keyof DirectusSchema>(
    collection: K,
    id: string,
    query?: { fields?: string[]; deep?: JsonObject },
): Promise<DirectusSchema[K][number] | null> {
    try {
        if (collection === "directus_users") {
            const user = await getDirectusClient().request(
                readUser(id, {
                    fields: query?.fields,
                } as never),
            );
            return user as DirectusSchema[K][number];
        }

        const item = await getDirectusClient().request(
            readItem(collection as Exclude<K, "directus_users">, id, {
                fields: query?.fields,
                deep: query?.deep,
            } as never),
        );
        return item as DirectusSchema[K][number];
    } catch (error) {
        if (isDirectusItemNotFound(error)) {
            return null;
        }
        throw toDirectusError(`读取集合 ${String(collection)} 明细`, error);
    }
}

export async function countItems<K extends keyof DirectusSchema>(
    collection: K,
    filter?: JsonObject,
): Promise<number> {
    const result = await runDirectusRequest(
        `统计集合 ${String(collection)} 总数`,
        async () => {
            return await getDirectusClient().request(
                aggregate(
                    collection as Exclude<K, "directus_users">,
                    {
                        aggregate: { count: "*" },
                        query: filter ? { filter } : {},
                    } as never,
                ),
            );
        },
    );
    const row = Array.isArray(result) ? result[0] : result;
    const count = (row as Record<string, unknown>)?.count;
    return typeof count === "number"
        ? count
        : parseInt(String(count ?? "0"), 10) || 0;
}

export async function createOne<K extends keyof DirectusSchema>(
    collection: K,
    payload: Partial<DirectusSchema[K][number]>,
    query?: { fields?: string[] },
): Promise<DirectusSchema[K][number]> {
    assertNonSystemCollection(collection);
    return (await runDirectusRequest(
        `创建集合 ${String(collection)} 数据`,
        async () => {
            return await getDirectusClient().request(
                createItem(
                    collection,
                    payload as never,
                    {
                        fields: query?.fields,
                    } as never,
                ),
            );
        },
    )) as DirectusSchema[K][number];
}

export async function updateOne<K extends keyof DirectusSchema>(
    collection: K,
    id: string,
    payload: Partial<DirectusSchema[K][number]>,
    query?: { fields?: string[] },
): Promise<DirectusSchema[K][number]> {
    assertNonSystemCollection(collection);
    const resolvedFields =
        query?.fields && query.fields.length > 0
            ? query.fields
            : collection === "app_diaries"
              ? [...SAFE_DIARY_FIELDS]
              : undefined;

    return (await runDirectusRequest(
        `更新集合 ${String(collection)} 数据`,
        async () => {
            return await getDirectusClient().request(
                updateItem(
                    collection,
                    id,
                    payload as never,
                    {
                        fields: resolvedFields,
                    } as never,
                ),
            );
        },
    )) as DirectusSchema[K][number];
}

export async function updateOneWithoutReadback<K extends keyof DirectusSchema>(
    collection: K,
    id: string,
    payload: Partial<DirectusSchema[K][number]>,
): Promise<void> {
    assertNonSystemCollection(collection);
    await runDirectusRequest(
        `更新集合 ${String(collection)} 数据`,
        async () => {
            await getDirectusClient().request(
                updateItem(
                    collection,
                    id,
                    payload as never,
                    {
                        fields: ["id"],
                    } as never,
                ),
            );
        },
    );
}

export async function deleteOne<K extends keyof DirectusSchema>(
    collection: K,
    id: string,
): Promise<void> {
    assertNonSystemCollection(collection);
    await runDirectusRequest(
        `删除集合 ${String(collection)} 数据`,
        async () => {
            await getDirectusClient().request(deleteItem(collection, id));
        },
    );
}

export async function createDirectusUser(payload: {
    email: string;
    password: string;
    first_name?: string;
    last_name?: string;
    status?: string;
}): Promise<{ id: string }> {
    const created = await runDirectusRequest("创建 Directus 用户", async () => {
        return await getDirectusClient().request(
            createUser(
                payload as never,
                {
                    fields: ["id"],
                } as never,
            ),
        );
    });

    const id =
        typeof (created as { id?: unknown }).id === "string"
            ? ((created as { id: string }).id ?? "")
            : String((created as { id?: unknown }).id ?? "");
    if (!id) {
        throw internal("创建用户成功但未返回 id");
    }
    return { id };
}

export async function updateDirectusUser(
    id: string,
    payload: JsonObject,
): Promise<{ id: string }> {
    const updated = await runDirectusRequest("更新 Directus 用户", async () => {
        return await getDirectusClient().request(
            updateUser(
                id,
                payload as never,
                {
                    fields: ["id"],
                } as never,
            ),
        );
    });

    const userId =
        typeof (updated as { id?: unknown }).id === "string"
            ? ((updated as { id: string }).id ?? "")
            : String((updated as { id?: unknown }).id ?? "");
    if (!userId) {
        throw internal("更新用户成功但未返回 id");
    }
    return { id: userId };
}

export async function deleteDirectusUser(id: string): Promise<void> {
    await runDirectusRequest("删除 Directus 用户", async () => {
        await getDirectusClient().request(
            customEndpoint({
                path: `/users/${encodeURIComponent(id)}`,
                method: "DELETE",
            }),
        );
    });
}

export async function listDirectusUsers(params?: {
    limit?: number;
    offset?: number;
    search?: string;
}): Promise<AppUser[]> {
    return (await runDirectusRequest("读取 Directus 用户列表", async () => {
        return await getDirectusClient().request(
            readUsers({
                fields: [
                    "id",
                    "email",
                    "first_name",
                    "last_name",
                    "avatar",
                    "role",
                ],
                limit: params?.limit ?? 50,
                offset: params?.offset ?? 0,
                search: params?.search,
            } as never),
        );
    })) as AppUser[];
}

export async function uploadDirectusFile(params: {
    file: File;
    title?: string;
    folder?: string;
}): Promise<{ id: string; title?: string; filename_download?: string }> {
    const form = new FormData();
    form.append("file", params.file, params.file.name);
    if (params.title) {
        form.append("title", params.title);
    }
    if (params.folder) {
        form.append("folder", params.folder);
    }

    const uploaded = await runDirectusRequest(
        "上传 Directus 文件",
        async () => {
            return await getDirectusClient().request(
                uploadFiles(form, {
                    fields: ["id", "title", "filename_download"],
                } as never),
            );
        },
    );

    const data = Array.isArray(uploaded) ? uploaded[0] : uploaded;
    const id =
        typeof (data as { id?: unknown }).id === "string"
            ? ((data as { id: string }).id ?? "")
            : String((data as { id?: unknown }).id ?? "");
    if (!id) {
        throw internal("文件上传成功但响应中缺少 id");
    }

    return {
        id,
        title:
            typeof (data as { title?: unknown }).title === "string"
                ? ((data as { title?: string }).title ?? undefined)
                : undefined,
        filename_download:
            typeof (data as { filename_download?: unknown })
                .filename_download === "string"
                ? ((data as { filename_download?: string }).filename_download ??
                  undefined)
                : undefined,
    };
}

export async function updateDirectusFileMetadata(
    id: string,
    payload: {
        title?: string | null;
        description?: string | null;
        filename_download?: string | null;
        folder?: string | null;
        uploaded_by?: string | null;
        modified_by?: string | null;
    },
): Promise<void> {
    await runDirectusRequest("更新 Directus 文件元数据", async () => {
        await getDirectusClient().request(updateFile(id, payload as never));
    });
}

export async function updateManyItemsByFilter(params: {
    collection: string;
    filter: JsonObject;
    data: JsonObject;
}): Promise<void> {
    const rows = await runDirectusRequest(
        `读取集合 ${params.collection} 批量更新候选`,
        async () => {
            return await getDirectusClient().request(
                customEndpoint({
                    path: `/items/${encodeURIComponent(params.collection)}`,
                    method: "GET",
                    params: {
                        filter: params.filter,
                        fields: ["id"],
                        limit: 5000,
                    },
                }),
            );
        },
    );
    const list = Array.isArray(rows)
        ? rows
        : Array.isArray((rows as { data?: unknown[] })?.data)
          ? ((rows as { data: unknown[] }).data ?? [])
          : [];
    const keys = list
        .map((item) => {
            if (item && typeof item === "object") {
                const record = item as { id?: unknown };
                return typeof record.id === "string"
                    ? record.id
                    : String(record.id ?? "");
            }
            return "";
        })
        .map((id) => id.trim())
        .filter(Boolean);
    if (keys.length === 0) {
        return;
    }
    await runDirectusRequest(
        `批量更新集合 ${params.collection} 数据`,
        async () => {
            await getDirectusClient().request(
                customEndpoint({
                    path: `/items/${encodeURIComponent(params.collection)}`,
                    method: "PATCH",
                    body: {
                        keys,
                        data: params.data,
                    } as never,
                }),
            );
        },
    );
}

/**
 * 删除 Directus 中的文件。
 * 删除失败时仅打印警告，不抛出异常，避免阻断业务流程。
 */
export async function deleteDirectusFile(fileId: string): Promise<void> {
    if (!fileId) {
        return;
    }
    try {
        await runDirectusRequest("删除 Directus 文件", async () => {
            await getDirectusClient().request(deleteFile(fileId));
        });
    } catch (err) {
        console.warn(
            "[directus/client] 删除文件失败，可能已不存在:",
            fileId,
            err,
        );
    }
}

export async function readDirectusAssetResponse(params: {
    fileId: string;
    query?: DirectusAssetQuery;
}): Promise<Response> {
    const result = await runDirectusRequest("读取 Directus 资源", async () => {
        return await getDirectusClient().request(
            customEndpoint<Response>({
                path: `/assets/${encodeURIComponent(params.fileId)}`,
                method: "GET",
                params: params.query,
                headers: {
                    Accept: "*/*",
                },
            }),
        );
    });

    if (result instanceof Response) {
        return result;
    }
    throw internal("资源响应格式无效");
}
