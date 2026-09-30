import { z } from "zod";

// Words that would read as a system page rather than a person at
// /students/<slug>, or collide with future routes there.
const RESERVED_SLUGS = new Set(["admin", "me", "new", "edit", "settings", "search", "api", "foundry", "support", "help"]);

// Optional free text: trimmed, and an empty string is stored as null so the
// public page simply hides the section instead of rendering a blank one.
const optionalText = (max, label) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be ${max} characters or fewer.`)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .optional();

// A short list of tags (interests, career goals): trimmed, blanks dropped,
// de-duplicated case-insensitively, and capped so a profile can't be stuffed.
const tagList = (maxItems, label) =>
  z
    .array(z.string().trim().max(30, `Each ${label} must be 30 characters or fewer.`))
    .max(maxItems * 2)
    .optional()
    .transform((items) => {
      const seen = new Set();
      const unique = [];
      for (const item of items ?? []) {
        const key = item.toLowerCase();
        if (item && !seen.has(key)) {
          seen.add(key);
          unique.push(item);
        }
      }
      return unique;
    })
    .refine((items) => items.length <= maxItems, `Add at most ${maxItems} ${label}s.`);

// A link the student chooses to publish: https only, and (for LinkedIn and
// GitHub) it must actually point at that site — the public page labels it
// as such, so it can't be a disguised link elsewhere.
const profileLink = (label, allowedHosts) =>
  z
    .string()
    .trim()
    .max(300, `${label} link is too long.`)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .optional()
    .refine((value) => {
      if (!value) return true;
      try {
        const url = new URL(value);
        if (url.protocol !== "https:") return false;
        if (!allowedHosts) return true;
        const host = url.hostname.toLowerCase();
        return allowedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
      } catch {
        return false;
      }
    }, allowedHosts ? `Enter your ${label} profile link (https://${allowedHosts[0]}/…).` : `Enter a full https:// link.`);

export const saveStudentProfileSchema = z
  .object({
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .min(3, "Your profile link needs at least 3 characters.")
      .max(40, "Your profile link must be 40 characters or fewer.")
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use only lowercase letters, numbers and single hyphens.")
      .refine((slug) => !RESERVED_SLUGS.has(slug), "That profile link is reserved — try another."),
    headline: optionalText(120, "Headline"),
    bio: optionalText(600, "About you"),
    interests: tagList(8, "interest"),
    careerGoals: tagList(5, "career goal"),
    linkedinUrl: profileLink("LinkedIn", ["linkedin.com"]),
    githubUrl: profileLink("GitHub", ["github.com"]),
    portfolioUrl: profileLink("Portfolio"),
    avatarObjectId: z.string().uuid().nullable().optional(),
    // Publishing is opt-in: every save re-confirms the student agrees to
    // show these details publicly.
    publishConsent: z.literal(true, { message: "Please agree to show this information publicly." }),
  })
  .strict("Only documented profile fields are accepted.");

export const profileSlugParamSchema = z.string().trim().toLowerCase().min(1).max(40);
