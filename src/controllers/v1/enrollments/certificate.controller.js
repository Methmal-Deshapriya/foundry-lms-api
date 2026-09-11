import * as certificateService from "../../../services/v1/enrollments/certificate.service.js";
import { ApiResponse } from "../../../utils/responseHandler.js";
import { ROLES } from "../../../constants/v1/users/users.constants.js";

/**
 * Certificate Controller
 */

export async function issueCertificate(req, res, next) {
  try {
    const { enrollmentId } = req.params;
    const actorId = req.user.id;
    const certificate = await certificateService.issueCertificateService(enrollmentId, req.body, actorId);
    return ApiResponse.send(res, certificate, "Certificate issued successfully", 201);
  } catch (error) {
    next(error);
  }
}

export async function revokeCertificate(req, res, next) {
  try {
    const { id } = req.params;
    const actorId = req.user.id;
    const certificate = await certificateService.revokeCertificateService(id, req.body, actorId);
    return ApiResponse.send(res, certificate, "Certificate revoked successfully");
  } catch (error) {
    next(error);
  }
}

export async function verifyCertificate(req, res, next) {
  try {
    const { code } = req.params;
    const result = await certificateService.verifyCertificateService(code);
    return ApiResponse.send(res, result, "Certificate verified successfully");
  } catch (error) {
    next(error);
  }
}

export async function getMyCertificates(req, res, next) {
  try {
    const userId = req.user.id;
    const certificates = await certificateService.getMyCertificatesService(
      userId,
      req.query,
    );
    return ApiResponse.send(res, certificates, "Your certificates fetched successfully");
  } catch (error) {
    next(error);
  }
}

export async function getAllCertificatesAdmin(req, res, next) {
  try {
    const certificates = await certificateService.getAllCertificatesAdminService(req.query);
    return ApiResponse.send(res, certificates, "All certificates fetched successfully");
  } catch (error) {
    next(error);
  }
}

export async function getCertificateDetails(req, res, next) {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const isAdmin = [ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(req.user.role);

    const certificate = await certificateService.getCertificateDetailsService(id, userId, isAdmin);
    return ApiResponse.send(res, certificate, "Certificate details fetched successfully");
  } catch (error) {
    next(error);
  }
}
