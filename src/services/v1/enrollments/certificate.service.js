import * as certificateRepo from "../../../repositories/v1/enrollments/certificate.repository.js";
import * as enrollmentRepo from "../../../repositories/v1/enrollments/enrollment.repository.js";
import { issueCertificateSchema, revokeCertificateSchema } from "../../../constants/v1/enrollments/certificate.schema.js";
import { generateCertificateCode } from "../../../utils/certificateUtils.js";
import { ValidationError, NotFoundError, ConflictError, ForbiddenError } from "../../../utils/Errors.js";
import { transformCertificate } from "../../../utils/transformers.js";
import { AUDIT_ACTIONS, ENTITY_TYPES } from "../../../constants/v1/audit/audit.constants.js";
import { recordActionService } from "../audit/audit.service.js";

const CERTIFICATE_CODE_ATTEMPTS = 5;

async function createCertificateWithUniqueCode(enrollment, certificateInput) {
  const publicAppUrl = process.env.PUBLIC_APP_URL || "http://localhost:3000";

  for (let attempt = 1; attempt <= CERTIFICATE_CODE_ATTEMPTS; attempt += 1) {
    const certificateCode = generateCertificateCode();
    try {
      const certificate = await certificateRepo.create({
        enrollmentId: enrollment.id,
        certificateCode,
        studentName: `${enrollment.user.firstName} ${enrollment.user.lastName}`,
        courseName: enrollment.course.title,
        description: certificateInput.description,
        issuedDate: certificateInput.issuedDate
          ? new Date(certificateInput.issuedDate)
          : new Date(),
        status: "ISSUED",
        certificateData: {
          skills: enrollment.course.skills,
          studentEmail: enrollment.user.email,
          courseSlug: enrollment.course.slug,
        },
        snapshotUrl: `${publicAppUrl}/certificates/verify/${certificateCode}`,
      });
      return { certificate, certificateCode };
    } catch (error) {
      if (!(error instanceof ConflictError)) throw error;

      // A create conflict may also mean another request issued a certificate
      // for this enrollment. Retry only when this exact random code exists.
      const collidedCode = await certificateRepo.findByCode(certificateCode);
      if (!collidedCode) throw error;
      if (attempt === CERTIFICATE_CODE_ATTEMPTS) {
        throw new ConflictError(
          "Could not generate a unique certificate code after several attempts. Please retry.",
          "CERTIFICATE_CODE_GENERATION_FAILED",
        );
      }
    }
  }

  throw new ConflictError(
    "Could not generate a unique certificate code.",
    "CERTIFICATE_CODE_GENERATION_FAILED",
  );
}

/**
 * Certificate Service
 */

/**
 * Service: Issue a certificate (Admin).
 */
export async function issueCertificateService(enrollmentId, data, actorId) {
  // 1. Validation
  const validation = issueCertificateSchema.safeParse(data);
  if (!validation.success) {
    const firstError = validation.error.issues[0];
    throw new ValidationError(firstError.message, firstError.path[0]);
  }

  // 2. Enrollment Checks
  const enrollment = await enrollmentRepo.findById(enrollmentId);
  if (!enrollment) {
    throw new NotFoundError("Enrollment not found.");
  }

  if (enrollment.status !== "COMPLETED") {
    throw new ValidationError("Enrollment must be marked as COMPLETED before issuing a certificate.");
  }
  if (!enrollment.course.certificateEnabled) {
    throw new ValidationError("Certificates are not enabled for this course.");
  }

  // 3. Duplicate Check
  const existing = await certificateRepo.findByEnrollmentId(enrollmentId);
  if (existing) {
    throw new ConflictError("A certificate has already been issued for this enrollment.");
  }

  // 4. Action: Prepare snapshot and create with bounded random-code retry.
  const { certificate, certificateCode } =
    await createCertificateWithUniqueCode(enrollment, validation.data);

  // 5. Audit
  recordActionService({
    actorUserId: actorId,
    action: AUDIT_ACTIONS.CERTIFICATE_ISSUED,
    entityType: ENTITY_TYPES.CERTIFICATE,
    entityId: certificate.id,
    description: `Certificate ${certificateCode} issued to student ${enrollment.user.email} for "${enrollment.course.title}"`,
    metadata: { enrollmentId, certificateCode }
  });

  return transformCertificate(certificate);
}

/**
 * Service: Revoke a certificate (Admin).
 */
export async function revokeCertificateService(id, data, actorId) {
  // 1. Validation
  const validation = revokeCertificateSchema.safeParse(data);
  if (!validation.success) {
    const firstError = validation.error.issues[0];
    throw new ValidationError(firstError.message, firstError.path[0]);
  }

  // 2. Action. The repository locks and rechecks both the credential and its
  // enrollment lifecycle before writing, preventing concurrent double revoke
  // or a stale lifecycle snapshot.
  const { certificate: updated, lifecycleContext } =
    await certificateRepo.revokeIssued(id, {
      status: "REVOKED",
      revokedAt: new Date(),
      revokedBy: actorId,
      revocationReason: validation.data.revocationReason,
    });

  // 3. Audit
  recordActionService({
    actorUserId: actorId,
    action: AUDIT_ACTIONS.CERTIFICATE_REVOKED,
    entityType: ENTITY_TYPES.CERTIFICATE,
    entityId: id,
    description: `Certificate ${updated.certificateCode} revoked by Admin ${actorId}`,
    metadata: {
      reason: validation.data.revocationReason,
      ...lifecycleContext,
    },
  });

  return transformCertificate(updated);
}

/**
 * Service: Verify a certificate (Public).
 */
export async function verifyCertificateService(certificateCode) {
  const certificate = await certificateRepo.findByCode(certificateCode);
  
  if (!certificate) {
    throw new NotFoundError("Invalid certificate code.");
  }

  return {
    studentName: certificate.studentName,
    courseName: certificate.courseName,
    issuedDate: certificate.issuedDate,
    certificateCode: certificate.certificateCode,
    status: certificate.status,
    skills: certificate.certificateData.skills,
  };
}

/**
 * Service: Get my certificates (Student).
 */
export async function getMyCertificatesService(userId) {
  const certificates = await certificateRepo.findUserCertificates(userId);
  return certificates.map(transformCertificate);
}

/**
 * Service: Get all certificates (Admin).
 */
export async function getAllCertificatesAdminService() {
  const certificates = await certificateRepo.findAllAdmin();
  return certificates.map(transformCertificate);
}

/**
 * Service: Get single certificate details.
 */
export async function getCertificateDetailsService(id, userId, isAdmin = false) {
  const certificate = await certificateRepo.findById(id);
  if (!certificate) {
    throw new NotFoundError("Certificate not found.");
  }

  if (!isAdmin && certificate.enrollment.userId !== userId) {
    throw new ForbiddenError("Access denied.");
  }

  return transformCertificate(certificate);
}
