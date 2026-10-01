import * as repository from "../../../repositories/v1/profiles/profile.repository.js";
import { saveStudentProfileSchema, profileSlugParamSchema } from "../../../constants/v1/profiles/profile.schema.js";
import { AUDIT_ACTIONS, ENTITY_TYPES } from "../../../constants/v1/audit/audit.constants.js";
import { NotFoundError, ValidationError } from "../../../utils/Errors.js";
import { publicObjectUrl } from "../../../config/r2.js";
import { resolveThumbnailUrl } from "../../../utils/thumbnails.js";
import Logger from "../../../utils/logger.js";
import { recordActionService } from "../audit/audit.service.js";
import { assertAttachableStoredObject, deleteStoredObjectService } from "../storage/storedObject.service.js";

/**
 * Public Student Profile Service — see the 2026-10-01 plan. A profile is
 * created only through the project-submission flow, and is publicly
 * visible only once the student has consented AND has at least one
 * approved public project.
 */

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new ValidationError(issue?.message ?? "Validation failed.", issue?.path?.[0]);
  }
  return result.data;
}

function avatarUrl(object) {
  return object?.status === "READY" ? publicObjectUrl(object.objectKey) : null;
}

function toOwnerResponse(profile, approvedProjectCount) {
  if (!profile) return { profile: null, isPublished: false, approvedProjectCount };
  return {
    profile: {
      slug: profile.slug,
      headline: profile.headline,
      bio: profile.bio,
      interests: profile.interests,
      careerGoals: profile.careerGoals,
      linkedinUrl: profile.linkedinUrl,
      githubUrl: profile.githubUrl,
      portfolioUrl: profile.portfolioUrl,
      avatarObjectId: profile.avatarObjectId,
      avatarUrl: avatarUrl(profile.avatarObject),
      publishConsentAt: profile.publishConsentAt,
      updatedAt: profile.updatedAt,
    },
    isPublished: Boolean(profile.publishConsentAt) && approvedProjectCount > 0,
    approvedProjectCount,
  };
}

export async function getMyProfileService(userId) {
  const [profile, approvedProjectCount] = await Promise.all([
    repository.findByUserId(userId),
    repository.countApprovedPublicProjects(userId),
  ]);
  return toOwnerResponse(profile, approvedProjectCount);
}

export async function saveMyProfileService(user, data) {
  const input = parse(saveStudentProfileSchema, data);
  const existing = await repository.findByUserId(user.id);

  const [slugOwner, formerOwner] = await Promise.all([repository.findBySlug(input.slug), repository.findByPreviousSlug(input.slug)]);
  // A link another student uses now — or used before, and may have shared —
  // can't be taken (code review M08-09).
  if ((slugOwner && slugOwner.userId !== user.id) || (formerOwner && formerOwner.userId !== user.id)) {
    throw new ValidationError("That profile link is already taken — try another.", "slug");
  }
  const slugChanged = Boolean(existing && existing.slug !== input.slug);
  const previousSlugs = slugChanged
    ? [...new Set([...(existing.previousSlugs ?? []), existing.slug])].filter((slug) => slug !== input.slug)
    : (existing?.previousSlugs ?? []).filter((slug) => slug !== input.slug);

  const avatarChanged = input.avatarObjectId !== undefined && input.avatarObjectId !== (existing?.avatarObjectId ?? null);
  if (avatarChanged && input.avatarObjectId) {
    // A student can only ever use a picture they uploaded themselves.
    await assertAttachableStoredObject(input.avatarObjectId, "STUDENT_AVATAR", { ownerUserId: user.id });
  }

  const { publishConsent: _consent, ...fields } = input;
  // The first save publishes the profile. Later edits keep whatever the
  // student chose with the Hide/Show control, so editing a hidden profile
  // doesn't quietly put it back online (M08-01).
  const saved = await repository.upsertForUser(user.id, {
    ...fields,
    previousSlugs,
    publishConsentAt: existing ? existing.publishConsentAt : new Date(),
  });

  // One picture per student: once the new one is saved (or the picture was
  // removed), the old file is deleted from storage. Best-effort — a failed
  // cleanup must never undo the student's successful save.
  if (avatarChanged && existing?.avatarObject) {
    deleteStoredObjectService(existing.avatarObject, user.id).catch((error) =>
      Logger.error(`[AVATAR_CLEANUP_FAILED]: Could not delete replaced avatar ${existing.avatarObject.id}`, error),
    );
  }

  recordActionService({
    actorUserId: user.id,
    action: AUDIT_ACTIONS.STUDENT_PROFILE_SAVED,
    entityType: ENTITY_TYPES.STUDENT_PROFILE,
    entityId: saved.id,
    description: `${existing ? "Updated" : "Created"} public profile /students/${saved.slug}.`,
    metadata: { created: !existing, avatarChanged },
  });

  return toOwnerResponse(saved, await repository.countApprovedPublicProjects(user.id));
}

/**
 * Hide or show the student's public page. Hiding withdraws their consent to
 * publish (Sri Lanka PDPA right to withdraw); the page then answers 404 like
 * any missing profile. Showing it again re-records consent now
 * (code review M08-01).
 */
export async function setProfilePublishedService(user, published) {
  const existing = await repository.findByUserId(user.id);
  if (!existing) throw new NotFoundError("Set up your public profile first.");
  const saved = await repository.setPublishConsent(user.id, published ? existing.publishConsentAt ?? new Date() : null);
  recordActionService({
    actorUserId: user.id,
    action: AUDIT_ACTIONS.STUDENT_PROFILE_SAVED,
    entityType: ENTITY_TYPES.STUDENT_PROFILE,
    entityId: saved.id,
    description: `${published ? "Published" : "Unpublished"} public profile /students/${saved.slug}.`,
    metadata: { published },
  });
  return toOwnerResponse(saved, await repository.countApprovedPublicProjects(user.id));
}

/** Used by project submission: a student must set up a profile first. */
export async function hasProfile(userId) {
  return Boolean(await repository.findByUserId(userId));
}

export async function getPublicProfileService(slugValue) {
  const slug = parse(profileSlugParamSchema, slugValue);
  const profile = await repository.findPublicBySlug(slug);
  const projects = profile?.user.studentProjects ?? [];
  // Not published (no consent, or no approved public project yet) reads
  // exactly like "doesn't exist" — never reveal that a draft profile exists.
  if (!profile) {
    // An old link this student changed away from: send the visitor to their
    // current page, when it's published (M08-09).
    const moved = await repository.findByPreviousSlug(slug);
    if (moved) {
      const current = await repository.findPublicBySlug(moved.slug);
      if (current?.publishConsentAt && current.user.studentProjects.length > 0) return { redirectToSlug: moved.slug };
    }
    throw new NotFoundError("Student profile not found.");
  }
  if (!profile.publishConsentAt || projects.length === 0) {
    throw new NotFoundError("Student profile not found.");
  }

  const certificates = profile.user.enrollments
    .flatMap((enrollment) => enrollment.certificates)
    .sort((a, b) => new Date(b.issuedDate) - new Date(a.issuedDate));

  return {
    slug: profile.slug,
    name: `${profile.user.firstName} ${profile.user.lastName}`.trim(),
    avatarUrl: avatarUrl(profile.avatarObject),
    headline: profile.headline,
    bio: profile.bio,
    interests: profile.interests,
    careerGoals: profile.careerGoals,
    links: { linkedin: profile.linkedinUrl, github: profile.githubUrl, portfolio: profile.portfolioUrl },
    learningSince: profile.user.createdAt,
    projects: projects.map((project) => ({
      id: project.id,
      title: project.title,
      description: project.description,
      thumbnailUrl: resolveThumbnailUrl(project),
      technologies: project.technologies,
      githubUrl: project.githubUrl,
      demoUrl: project.demoUrl,
      projectUrl: project.projectUrl,
      courseTitle: project.intake?.course?.title ?? null,
    })),
    // An "achievements" list rather than a certificates-only field, so
    // course badges can join it later without changing the page's shape.
    achievements: certificates.map((certificate) => ({
      type: "CERTIFICATE",
      title: certificate.courseName,
      issuedAt: certificate.issuedDate,
      verificationCode: certificate.certificateCode,
    })),
  };
}
