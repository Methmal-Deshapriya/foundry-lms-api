import prisma from "../../../utils/prisma.js";
import { handlePrismaError } from "../../../utils/Errors.js";

/**
 * Public Student Profile Repository
 */

export function findByUserId(userId) {
  return prisma.studentProfile.findUnique({ where: { userId }, include: { avatarObject: true } });
}

export function findBySlug(slug) {
  return prisma.studentProfile.findUnique({ where: { slug }, select: { userId: true } });
}

/** The profile that used to have this link, if any (M08-09). */
export function findByPreviousSlug(slug) {
  return prisma.studentProfile.findFirst({ where: { previousSlugs: { has: slug } }, select: { userId: true, slug: true } });
}

export async function setPublishConsent(userId, publishConsentAt) {
  try {
    return await prisma.studentProfile.update({ where: { userId }, data: { publishConsentAt }, include: { avatarObject: true } });
  } catch (error) {
    throw handlePrismaError(error);
  }
}

export async function upsertForUser(userId, data) {
  try {
    return await prisma.studentProfile.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
      include: { avatarObject: true },
    });
  } catch (error) {
    throw handlePrismaError(error);
  }
}

export function countApprovedPublicProjects(userId) {
  return prisma.studentProject.count({ where: { userId, status: "APPROVED", isPublic: true } });
}

// Everything the public page shows, and nothing else: the select is the
// allow-list. No email, phone, address, date of birth, district, A/L
// stream, enrollments or payments are ever read here.
export function findPublicBySlug(slug) {
  return prisma.studentProfile.findUnique({
    where: { slug },
    select: {
      slug: true,
      headline: true,
      bio: true,
      interests: true,
      careerGoals: true,
      linkedinUrl: true,
      githubUrl: true,
      portfolioUrl: true,
      publishConsentAt: true,
      avatarObject: { select: { status: true, objectKey: true } },
      user: {
        select: {
          firstName: true,
          lastName: true,
          createdAt: true,
          studentProjects: {
            where: { status: "APPROVED", isPublic: true },
            orderBy: [{ displayOrder: "asc" }, { createdAt: "desc" }],
            select: {
              id: true,
              title: true,
              description: true,
              thumbnailUrl: true,
              thumbnailObject: { select: { status: true, objectKey: true } },
              technologies: true,
              githubUrl: true,
              demoUrl: true,
              projectUrl: true,
              intake: { select: { course: { select: { title: true } } } },
            },
          },
          enrollments: {
            select: {
              certificates: {
                where: { status: "ISSUED" },
                select: { certificateCode: true, courseName: true, issuedDate: true },
              },
            },
          },
        },
      },
    },
  });
}
