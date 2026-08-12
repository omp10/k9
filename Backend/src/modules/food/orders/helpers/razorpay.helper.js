import crypto from 'crypto';

let Razorpay;
try {
    const mod = await import('razorpay');
    Razorpay = mod.default;
} catch {
    Razorpay = null;
}

import { config } from '../../../../config/env.js';
import { logger } from '../../../../utils/logger.js';
import { normalizePhoneToTenDigits } from '../../../../utils/phone.util.js';
const KEY_ID = String(config.razorpayKeyId || process.env.RAZORPAY_KEY_ID || '').trim();
const KEY_SECRET = String(config.razorpayKeySecret || process.env.RAZORPAY_KEY_SECRET || '').trim();

function getRazorpayErrorMessage(error) {
    return (
        error?.error?.description ||
        error?.error?.message ||
        error?.description ||
        error?.message ||
        'Razorpay request failed'
    );
}

export function isRazorpayConfigured() {
    return Boolean(KEY_ID && KEY_SECRET && Razorpay);
}

export function getRazorpayKeyId() {
    return KEY_ID;
}

export function getRazorpayInstance() {
    if (!isRazorpayConfigured()) return null;
    return new Razorpay({ key_id: KEY_ID, key_secret: KEY_SECRET });
}

export function createRazorpayOrder(amountPaise, currency = 'INR', receipt = '') {
    const instance = getRazorpayInstance();
    if (!instance) return Promise.reject(new Error('Razorpay not configured'));
    return instance.orders
        .create({
            amount: Math.round(amountPaise),
            currency,
            receipt: receipt || undefined
        })
        .catch((error) => {
            const errMsg = getRazorpayErrorMessage(error);
            logger.error(`[Razorpay] Order Creation Failed: ${errMsg}`);
            
            if (errMsg.includes('Authentication failed') || errMsg.includes('invalid api key')) {
                // Strictly non-production. This used to also fire on
                // config.useDefaultOtp, which is the *login* OTP shortcut — and
                // with NODE_ENV=production plus USE_DEFAULT_OTP=true the OR was
                // true, so a live deployment with rejected Razorpay credentials
                // silently handed the app a "mock_order_..." id instead of
                // surfacing the 401. The rider was sent to a checkout that could
                // never succeed and the order sat in pending_payment.
                //
                // A login convenience flag must never mint payment orders.
                const isMockAllowed = config.nodeEnv !== 'production';
                if (isMockAllowed) {
                    logger.warn(`[Razorpay] Generating fallback Mock Order due to Authentication failed`);
                    return {
                        id: `mock_order_${Date.now()}`,
                        amount: Math.round(amountPaise),
                        currency
                    };
                }
            }
            throw new Error(errMsg);
        });
}

export async function createRazorpayCheckoutOrder(amountPaise, currency = 'INR', receipt = '') {
    if (!isRazorpayConfigured()) {
        throw new Error('Razorpay payment gateway is not configured');
    }

    const roundedAmount = Math.round(Number(amountPaise) || 0);
    if (roundedAmount < 100) {
        throw new Error('Amount too low for online payment');
    }

    const order = await createRazorpayOrder(roundedAmount, currency, receipt);
    if (!order?.id) {
        throw new Error('Razorpay order was created without an order id');
    }

    return {
        key: getRazorpayKeyId(),
        orderId: String(order.id || ''),
        amount: Number(order.amount) || roundedAmount,
        currency: order.currency || currency
    };
}

export function createPaymentLink({ amountPaise, currency = 'INR', description, orderId, customerName, customerEmail, customerPhone }) {
    const instance = getRazorpayInstance();
    if (!instance) return Promise.reject(new Error('Razorpay not configured'));

    const contact = normalizePhoneToTenDigits(customerPhone);
    const payload = {
        amount: Math.round(amountPaise),
        currency,
        description: description || `Order ${orderId}`,
        customer: {
            name: customerName || 'Customer',
            email: customerEmail || 'customer@example.com',
            contact
        }
    };

    logger.info(`[Razorpay] Creating Payment Link for Order ${orderId}: Amount ${amountPaise} Paise, Contact: ${contact}`);

    return instance.paymentLink
        .create(payload)
        .catch((error) => {
            const errMsg = getRazorpayErrorMessage(error);
            logger.error(`[Razorpay] Payment Link Failed for Order ${orderId}: ${errMsg}`);
            
            if (errMsg.includes('Authentication failed') || errMsg.includes('invalid api key')) {
                const isMockAllowed = config.nodeEnv !== 'production' || config.useDefaultOtp;
                if (isMockAllowed) {
                    logger.warn(`[Razorpay] Falling back to standard UPI URI due to Authentication failed`);
                    return {
                        id: `mock_plink_${Date.now()}`,
                        short_url: `upi://pay?pa=k9rides@ybl&pn=K9Rides&am=${(amountPaise / 100).toFixed(2)}&tr=${orderId}`,
                        status: 'created',
                        expire_by: Math.floor(Date.now() / 1000) + 86400
                    };
                }
            }
            throw new Error(errMsg);
        });
}

export function verifyPaymentSignature(orderId, paymentId, signature) {
    const isMockAllowed = config.nodeEnv !== 'production' || config.useDefaultOtp;
    if (isMockAllowed && signature === 'mock_signature_bypass' && String(orderId || '').startsWith('mock_order_')) {
        return true;
    }
    if (!KEY_SECRET) return false;
    const body = `${orderId}|${paymentId}`;
    const expected = crypto.createHmac('sha256', KEY_SECRET).update(body).digest('hex');
    return expected === signature;
}

/**
 * Fetch Razorpay payment (server-side) for additional validation (amount/status/order match).
 * @param {string} paymentId
 */
export async function fetchRazorpayPayment(paymentId) {
    const instance = getRazorpayInstance();
    if (!instance) throw new Error('Razorpay not configured');
    if (!paymentId) throw new Error('paymentId is required');
    return instance.payments.fetch(String(paymentId)).catch((error) => {
        throw new Error(getRazorpayErrorMessage(error));
    });
}

/**
 * Fetch Razorpay payment-link to check status (used for Razorpay QR auto verification).
 * @param {string} paymentLinkId
 */
export function fetchRazorpayPaymentLink(paymentLinkId) {
    if (String(paymentLinkId || '').startsWith('mock_plink_')) {
        return Promise.resolve({
            id: paymentLinkId,
            status: 'created'
        });
    }
    const instance = getRazorpayInstance();
    if (!instance) return Promise.reject(new Error('Razorpay not configured'));
    return instance.paymentLink.fetch(String(paymentLinkId)).catch((error) => {
        throw new Error(getRazorpayErrorMessage(error));
    });
}

/**
 * ✅ NEW: Initiate a refund for a successful payment.
 * NON-BREAKING Extension for automated cancellation refunds.
 * @param {string} paymentId - Original Razorpay payment_id (captured)
 * @param {number} amount - Amount to refund (in major unit, e.g., INR 123.45)
 */
export async function initiateRazorpayRefund(paymentId, amount) {
    const isMockAllowed = config.nodeEnv !== 'production' || config.useDefaultOtp;
    if (isMockAllowed && (!paymentId || String(paymentId).startsWith('mock_'))) {
        logger.info(`[Razorpay] Mock Refund triggered for payment ID: ${paymentId}`);
        return {
            success: true,
            refundId: `mock_ref_${Date.now()}`,
            status: 'processed',
            raw: { id: `mock_ref_${Date.now()}`, status: 'processed' }
        };
    }
    if (!isRazorpayConfigured()) {
        throw new Error('Razorpay is not configured on this server');
    }
    const instance = getRazorpayInstance();
    try {
        const refund = await instance.payments.refund(paymentId, {
            amount: Math.round(Number(amount) * 100), // convert to paise
            notes: {
                reason: 'Order cancelled by system flow',
                at: new Date().toISOString()
            }
        });
        return {
            success: true,
            refundId: refund.id,
            status: refund.status || 'processed',
            raw: refund
        };
    } catch (err) {
        // Log locally but pass the error to the service to handle status update
        console.error(`Razorpay Refund API Failure [PaymentId: ${paymentId}]:`, err?.message || err);
        return {
            success: false,
            error: err?.message || 'Razorpay refund API error',
            status: 'failed'
        };
    }
}
