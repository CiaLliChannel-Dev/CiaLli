/**
 * 举报相关 Zod Schema
 */
import * as z from "zod";

import {
    OptionalStringSchema,
    ReportReasonSchema,
    ReportStatusSchema,
    ReportTargetTypeSchema,
} from "./common";

// ── 创建举报 ──

export const CreateReportSchema = z.object({
    target_type: ReportTargetTypeSchema,
    target_id: z.string().min(1, "举报目标 ID 必填"),
    target_user_id: OptionalStringSchema,
    reason: ReportReasonSchema.default("other"),
    detail: OptionalStringSchema,
});

export type CreateReportInput = z.infer<typeof CreateReportSchema>;

// ── 更新举报 ──

export const UpdateReportSchema = z
    .object({
        detail: OptionalStringSchema,
        report_status: ReportStatusSchema,
    })
    .partial();

export type UpdateReportInput = z.infer<typeof UpdateReportSchema>;
