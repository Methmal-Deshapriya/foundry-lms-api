import { z } from "zod";

export const NOTIFICATION_AUDIENCES = Object.freeze(["ALL_STUDENTS", "COURSE", "INTAKE", "PARTIAL_PAYERS", "COURSE_INTEREST"]);
export const PUBLISH_STATUSES = Object.freeze(["DRAFT", "PUBLISHED", "ARCHIVED"]);
export const PROMOTION_THEMES = Object.freeze(["DARK", "LIGHT", "RED"]);

const optionalText = (max, label) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be ${max} characters or fewer.`)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .optional();

export const IN_APP_PATH = /^\/(?![/\\])[^\\]*$/;

// A button/link target: an in-app path ("/explore") or a full https:// URL.
export const linkUrlField = z
  .string()
  .trim()
  .max(300)
  .transform((value) => (value === "" ? null : value))
  .nullable()
  .optional()
  .refine((value) => {
    if (!value) return true;
    // An in-app path. No second slash or backslash after the first one, and
    // no backslash anywhere: browsers read "/\\evil.com" as "//evil.com",
    // another site (code review M09-07).
    if (IN_APP_PATH.test(value)) return true;
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }, "Use a page path like /explore, or a full https:// link.");

const dateField = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), "Enter a valid date and time.")
  .nullable()
  .optional();

function windowIsValid(data) {
  return !data.startsAt || !data.endsAt || new Date(data.endsAt) > new Date(data.startsAt);
}

export const saveNotificationSchema = z
  .object({
    title: z.string({ error: "Add a title." }).trim().min(3, "The title needs at least 3 characters.").max(120),
    message: z.string({ error: "Write the message." }).trim().min(1, "Write the message.").max(1000),
    audience: z.enum(NOTIFICATION_AUDIENCES, { error: "Choose who should see this." }),
    courseId: z.string().uuid().nullable().optional(),
    intakeId: z.string().uuid().nullable().optional(),
    linkLabel: optionalText(40, "Button label"),
    linkUrl: linkUrlField,
    pinned: z.boolean().optional().default(false),
    startsAt: dateField,
    endsAt: dateField,
  })
  .strict("Only documented notification fields are accepted.")
  .refine((data) => !["COURSE", "COURSE_INTEREST"].includes(data.audience) || data.courseId, { message: "Choose the course.", path: ["courseId"] })
  .refine((data) => data.audience !== "INTAKE" || data.intakeId, { message: "Choose the intake.", path: ["intakeId"] })
  .refine((data) => !data.linkUrl || data.linkLabel, { message: "Add a label for the button.", path: ["linkLabel"] })
  .refine(windowIsValid, { message: "The end must be after the start.", path: ["endsAt"] });

export const publishNotificationSchema = z
  .object({ sendEmail: z.boolean().optional().default(false) })
  .strict("Only documented publish fields are accepted.");

export const notificationAdminFiltersSchema = z.object({
  status: z.enum(PUBLISH_STATUSES).optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const audienceQuerySchema = z.object({
  audience: z.enum(NOTIFICATION_AUDIENCES),
  courseId: z.string().uuid().optional(),
  intakeId: z.string().uuid().optional(),
});

export const savePromotionSchema = z
  .object({
    internalName: z.string({ error: "Name this promotion." }).trim().min(1, "Name this promotion.").max(80),
    headline: z.string({ error: "Write a headline." }).trim().min(3, "The headline needs at least 3 characters.").max(90),
    message: optionalText(200, "Message"),
    badge: optionalText(24, "Badge"),
    theme: z.enum(PROMOTION_THEMES).optional().default("DARK"),
    imageObjectId: z.string().uuid().nullable().optional(),
    ctaLabel: optionalText(30, "Button label"),
    ctaUrl: linkUrlField,
    showCountdown: z.boolean().optional().default(false),
    startsAt: dateField,
    endsAt: dateField,
  })
  .strict("Only documented promotion fields are accepted.")
  .refine((data) => !data.ctaUrl || data.ctaLabel, { message: "Add a label for the button.", path: ["ctaLabel"] })
  .refine((data) => !data.showCountdown || data.endsAt, { message: "A countdown needs an end date.", path: ["endsAt"] })
  .refine(windowIsValid, { message: "The end must be after the start.", path: ["endsAt"] });

export const promotionAdminFiltersSchema = notificationAdminFiltersSchema;
