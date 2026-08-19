import { requestUserOtpController, verifyUserOtpController } from './auth.controller.js';

/**
 * Unified Request OTP: Hits the standard user OTP request.
 * In a real production scenario, this could also trigger a sync with Taxi backend if they are separate.
 */
export const requestUnifiedOtpController = async (req, res, next) => {
    // Reuse the standard user OTP request. `next` MUST be forwarded: the delegate calls
    // next(error) in its catch block, and omitting it turned every handled error (e.g. an
    // OTP rate-limit hit) into "TypeError: next is not a function" -> unhandled rejection
    // -> the whole process crashed and PM2 crash-looped, taking the API down with a 502.
    return requestUserOtpController(req, res, next);
};

/**
 * Unified Verify OTP: Verifies OTP and ensures tokens are valid for the Super App context.
 */
export const verifyUnifiedOtpController = async (req, res, next) => {
    // Reusing standard verification which returns { accessToken, refreshToken, user }
    return verifyUserOtpController(req, res, next);
};
