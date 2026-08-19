import { verifyAccessToken } from './token.util.js';
import { sendError } from '../../utils/response.js';
import { FoodUser } from '../users/user.model.js';
import mongoose from 'mongoose';
import { isAdminRole } from '../../utils/roles.js';

export const requireAdmin = (req, res, next) => {
    if (!isAdminRole(req.user?.role)) {
        return sendError(res, 403, 'Admin access required');
    }
    next();
};

export const authMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;

    if (!token) {
        return sendError(res, 401, 'Authentication token missing');
    }

    try {
        const decoded = verifyAccessToken(token);
        const userId = decoded.userId || decoded.sub || '';
        const role = String(decoded.role || '').toUpperCase();
        req.user = {
            userId,
            role
        };
        if (role === 'USER') {
            if (!mongoose.Types.ObjectId.isValid(userId)) {
                return sendError(res, 401, 'Invalid user token');
            }
            // Enforce active status in real-time - deactivated users are logged out on next request.
            FoodUser.findById(userId).select('isActive').lean().then((doc) => {
                if (!doc || doc.isActive === false) {
                    return sendError(res, 401, doc ? 'User account is deactivated' : 'User account not found');
                }
                next();
            }).catch(() => sendError(res, 401, 'Invalid user token'));
            return;
        }
        return next();
    } catch (error) {
        return sendError(res, 401, 'Invalid or expired token');
    }
};
