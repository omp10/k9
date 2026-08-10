import { Admin } from '../admin/models/Admin.js';
import { Owner } from '../admin/models/Owner.js';
import { ServiceStore } from '../admin/models/ServiceStore.js';
import { ServiceCenterStaff } from '../admin/models/ServiceCenterStaff.js';
import { ApiError } from '../../../utils/ApiError.js';
import { Driver } from '../driver/models/Driver.js';
import { BusDriver } from '../driver/models/BusDriver.js';
import { User } from '../user/models/User.js';
import { verifyAccessToken } from '../services/tokenService.js';
import { resolveUnifiedDriverIdentity } from '../services/driverIdentityBridge.js';
import {
  normalizeAdminPermissions,
  normalizeAdminType,
} from '../admin/services/adminAccessService.js';

const roleModelMap = {
  admin: Admin,
  'super-admin': Admin,
  driver: Driver,
  bus_driver: BusDriver,
  owner: Owner,
  service_center: ServiceStore,
  service_center_staff: ServiceCenterStaff,
  user: User,
};

const normalizeRole = (role = '') => {
  const value = String(role || '').toLowerCase();
  if (value === 'super-admin') {
    return 'admin';
  }
  return value;
};

const attachResolvedAuth = (req, payload) => {
  req.auth = {
    sub: payload.sub,
    role: normalizeRole(payload.role),
    originalRole: payload.role,
  };
};

const resolveOpenUserIdentity = async (req) => {
  const explicitUserId =
    req.headers['x-user-id'] ||
    req.body?.userId ||
    req.query?.userId ||
    req.params?.userId ||
    null;

  const query = explicitUserId ? { _id: explicitUserId } : {};
  const user = await User.findOne(query).sort({ createdAt: 1 });

  if (!user) {
    throw new ApiError(404, 'No user account is available for open user access');
  }

  attachResolvedAuth(req, {
    sub: String(user._id),
    role: 'user',
  });
};

export const authenticate = (allowedRoles = [], options = {}) => async (req, _res, next) => {
  try {
    const allowPending = options?.allowPending === true;
    const authorization = req.headers.authorization || '';
    const [, token] = authorization.split(' ');

    if (!token) {
      throw new ApiError(401, 'Authorization token is required');
    }

    const payload = await resolveUnifiedDriverIdentity(verifyAccessToken(token));

    const normalizedRole = normalizeRole(payload.role);
    const normalizedAllowedRoles = allowedRoles.map(normalizeRole);

    if (normalizedAllowedRoles.length > 0 && !normalizedAllowedRoles.includes(normalizedRole)) {
      throw new ApiError(403, 'Insufficient permissions for this resource');
    }

    const Model = roleModelMap[payload.role] || roleModelMap[normalizedRole];
    const subjectId = payload.sub || payload.userId || payload.id || null;

    if (!Model) {
      throw new ApiError(401, 'Unsupported auth role');
    }

    if (!subjectId) {
      throw new ApiError(401, 'Authorization token is invalid');
    }

    const entity = await Model.findById(subjectId);

    if (!entity) {
      throw new ApiError(401, 'Authenticated account no longer exists');
    }

    if (
      normalizedRole === 'user' &&
      (entity.deletedAt || entity.isActive === false || entity.active === false)
    ) {
      throw new ApiError(401, 'User account is not active');
    }

    if (
      normalizedRole === 'driver' &&
      !allowPending &&
      (entity.approve === false || String(entity.status || '').toLowerCase() === 'pending')
    ) {
      throw new ApiError(403, 'Driver account is pending approval');
    }

    if (
      normalizedRole === 'owner' &&
      !allowPending &&
      (entity.active === false ||
        entity.approve === false ||
        String(entity.status || '').toLowerCase() === 'pending')
    ) {
      throw new ApiError(403, 'Owner account is pending approval');
    }

    if (
      normalizedRole === 'bus_driver' &&
      (entity.active === false ||
        entity.approve === false ||
        ['pending', 'blocked'].includes(String(entity.status || '').toLowerCase()))
    ) {
      throw new ApiError(403, 'Bus driver account is pending approval');
    }

    if (
      normalizedRole === 'service_center' &&
      (entity.active === false || String(entity.status || '').toLowerCase() === 'inactive')
    ) {
      throw new ApiError(403, 'Service center account is inactive');
    }

    if (
      normalizedRole === 'service_center_staff' &&
      (entity.active === false || String(entity.status || '').toLowerCase() === 'inactive')
    ) {
      throw new ApiError(403, 'Service center staff account is inactive');
    }

    attachResolvedAuth(req, { ...payload, sub: String(subjectId) });
    req.auth.entity = entity;

    if (normalizedRole === 'admin') {
      req.auth.admin = {
        id: String(entity._id),
        email: entity.email || '',
        name: entity.name || '',
        role: entity.role || '',
        admin_type: normalizeAdminType(entity.admin_type || entity.role),
        permissions: normalizeAdminPermissions(entity.permissions || []),
        service_location_ids: Array.isArray(entity.service_location_ids)
          ? entity.service_location_ids.map((item) => String(item))
          : [],
        zone_ids: Array.isArray(entity.zone_ids)
          ? entity.zone_ids.map((item) => String(item))
          : [],
        active: entity.active !== false,
        status: entity.status || 'active',
      };

      if (req.auth.admin.active === false || String(req.auth.admin.status).toLowerCase() === 'inactive') {
        throw new ApiError(403, 'Admin account is inactive');
      }
    }

    next();
  } catch (error) {
    if (error?.name === 'TokenExpiredError') {
      return next(new ApiError(401, 'Authorization token has expired'));
    }
    if (error?.name === 'JsonWebTokenError' || error?.name === 'NotBeforeError') {
      return next(new ApiError(401, 'Authorization token is invalid'));
    }
    next(error);
  }
};

export const authenticateOrResolveUser = (allowedRoles = ['user']) => async (req, res, next) => {
  const authorization = req.headers.authorization || '';
  const [, token] = authorization.split(' ');

  if (token) {
    return authenticate(allowedRoles)(req, res, next);
  }

  try {
    if (!allowedRoles.includes('user')) {
      throw new ApiError(401, 'Authorization token is required');
    }

    await resolveOpenUserIdentity(req);
    next();
  } catch (error) {
    next(error);
  }
};
