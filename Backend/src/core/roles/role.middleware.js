import { sendError } from '../../utils/response.js';

export const requireRoles = (...allowedRoles) => {
    return (req, res, next) => {
        if (!req.user || !req.user.role) {
            return sendError(res, 401, 'Not authenticated');
        }

        // Admin accounts are issued as ADMIN / SUPER_ADMIN / SUPER-ADMIN / SUPERADMIN /
        // PLATFORM_SUPERADMIN depending on how they were created. They all mean ADMIN here;
        // matching only the literal string locked valid super-admins out of every food admin
        // route with a 403.
        const rawRole = String(req.user.role).toUpperCase();
        const userRole = /^(SUPER[-_ ]?ADMIN|PLATFORM[-_ ]?SUPERADMIN|SUPERADMIN)$/.test(rawRole)
            ? 'ADMIN'
            : rawRole;
        const allowedSet = new Set(allowedRoles.map((r) => String(r).toUpperCase()));
        if (!allowedSet.has(userRole)) {
            return sendError(res, 403, 'Forbidden: insufficient permissions');
        }

        next();
    };
};

