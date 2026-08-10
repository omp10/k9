import { Router } from 'express';
import { asyncHandler } from '../../../../utils/asyncHandler.js';
import { authenticateOrResolveUser } from '../../middlewares/authMiddleware.js';
import {
  cancelMyBusBooking,
  createBusBookingOrder,
  createRentalAdvancePaymentOrder,
  payRentalAdvanceWithWallet,
  createRentalBookingRequest,
  createRentalQuoteRequest,
  createRazorpayWalletTopupOrder,
  createPhonePeWalletTopupOrder,
  getBusSeatLayout,
  getBusRouteSuggestions,
  getMyBusBookingById,
  listMyBusBookings,
  getUserWallet,
  getCurrentUser,
  getUserNotifications,
  deleteUserNotification,
  endMyActiveRentalRide,
  getIntercityPackageCatalog,
  clearAllUserNotifications,
  getMyActiveRentalBooking,
  listPublicServiceLocations,
  listPublicServiceStores,
  listMyRentalBookings,
  loginUser,
  registerUser,
  requestAccountDeletion,
  searchBuses,
  signupUser,
  startUserOtpRequest,
  submitMyBusBookingReview,
  topupUserWallet,
  transferUserWalletToDriver,
  transferUserWallet,
  updateMyActiveRentalLocation,
  updateCurrentUser,
  uploadUserProfileImage,
  verifyBusBookingPayment,
  verifyRentalAdvancePayment,
  verifyRazorpayWalletTopup,
  verifyPhonePeWalletTopup,
  verifyUserOtpRequest,
  verifyUserPhoneForOtpLogin,
  getAvailableSubscriptionPlans,
  getMySubscriptions,
  buySubscription,
} from '../controllers/userController.js';
import {
  searchPoolingRoutes,
  getPoolingRouteDetails,
  createPoolingBookingOrder,
  verifyPoolingBookingPayment,
  createPoolingBooking,
  getMyPoolingBookings
} from '../controllers/poolingController.js';
import { getAppModules, getGoodsTypes, getPublicRentalVehicleCatalog, getPublicSetPrices, getPublicVehicleTypeCatalog } from '../../admin/controllers/adminController.js';
import { triggerUserSosAlert } from '../../safety/controllers/safetyController.js';

export const userRouter = Router();

userRouter.get('/app-modules', asyncHandler(getAppModules));
userRouter.get('/intercity-packages', asyncHandler(getIntercityPackageCatalog));
userRouter.get('/goods-types', asyncHandler(getGoodsTypes));
userRouter.get('/vehicle-types', asyncHandler(getPublicVehicleTypeCatalog));
// Public tariffs. Present pre-merge as userRouter.get('/set-prices'); the
// rider app has always read fares from here and shows blank prices without it.
userRouter.get('/set-prices', asyncHandler(getPublicSetPrices));
userRouter.get('/service-locations', asyncHandler(listPublicServiceLocations));
userRouter.get('/service-stores', asyncHandler(listPublicServiceStores));
// userRouter.get('/rental-vehicles', asyncHandler(getPublicRentalVehicleCatalog));
// userRouter.post('/rental-quote-requests', asyncHandler(createRentalQuoteRequest));
// userRouter.post('/rental-bookings', authenticateOrResolveUser(['user']), asyncHandler(createRentalBookingRequest));
// userRouter.get('/rental-bookings', authenticateOrResolveUser(['user']), asyncHandler(listMyRentalBookings));
// userRouter.get('/rental-bookings/active', authenticateOrResolveUser(['user']), asyncHandler(getMyActiveRentalBooking));
// userRouter.post('/rental-bookings/:id/end', authenticateOrResolveUser(['user']), asyncHandler(endMyActiveRentalRide));
// userRouter.post('/rental-bookings/:id/location', authenticateOrResolveUser(['user']), asyncHandler(updateMyActiveRentalLocation));
userRouter.post('/register', asyncHandler(registerUser));
userRouter.post('/signup', asyncHandler(signupUser));
userRouter.post('/login', asyncHandler(loginUser));
userRouter.post('/profile-image', asyncHandler(uploadUserProfileImage));
userRouter.post('/auth/send-otp', asyncHandler(startUserOtpRequest));
userRouter.post('/auth/verify-otp', asyncHandler(verifyUserOtpRequest));
userRouter.post('/otp-login', asyncHandler(verifyUserPhoneForOtpLogin));
userRouter.get('/me', authenticateOrResolveUser(['user']), asyncHandler(getCurrentUser));
userRouter.patch('/me', authenticateOrResolveUser(['user']), asyncHandler(updateCurrentUser));
userRouter.get('/subscriptions/plans', authenticateOrResolveUser(['user']), asyncHandler(getAvailableSubscriptionPlans));
userRouter.get('/subscriptions/me', authenticateOrResolveUser(['user']), asyncHandler(getMySubscriptions));
userRouter.post('/subscriptions/purchase', authenticateOrResolveUser(['user']), asyncHandler(buySubscription));
userRouter.post('/me/delete-request', authenticateOrResolveUser(['user']), asyncHandler(requestAccountDeletion));
userRouter.get('/notifications', authenticateOrResolveUser(['user']), asyncHandler(getUserNotifications));
userRouter.delete('/notifications/:id', authenticateOrResolveUser(['user']), asyncHandler(deleteUserNotification));
userRouter.delete('/notifications', authenticateOrResolveUser(['user']), asyncHandler(clearAllUserNotifications));
userRouter.post('/sos', authenticateOrResolveUser(['user']), asyncHandler(triggerUserSosAlert));
userRouter.get('/wallet', authenticateOrResolveUser(['user']), asyncHandler(getUserWallet));
userRouter.post('/wallet/topup', authenticateOrResolveUser(['user']), asyncHandler(topupUserWallet));
userRouter.post('/wallet/transfer', authenticateOrResolveUser(['user']), asyncHandler(transferUserWallet));
userRouter.post('/wallet/transfer/driver', authenticateOrResolveUser(['user']), asyncHandler(transferUserWalletToDriver));
userRouter.post('/wallet/razorpay/order', authenticateOrResolveUser(['user']), asyncHandler(createRazorpayWalletTopupOrder));
userRouter.post('/wallet/razorpay/verify', authenticateOrResolveUser(['user']), asyncHandler(verifyRazorpayWalletTopup));
userRouter.post('/wallet/phonepe/order', authenticateOrResolveUser(['user']), asyncHandler(createPhonePeWalletTopupOrder));
userRouter.get('/wallet/phonepe/status/:merchantTransactionId', authenticateOrResolveUser(['user']), asyncHandler(verifyPhonePeWalletTopup));
// userRouter.post('/rental-advance/razorpay/order', authenticateOrResolveUser(['user']), asyncHandler(createRentalAdvancePaymentOrder));
// userRouter.post('/rental-advance/razorpay/verify', authenticateOrResolveUser(['user']), asyncHandler(verifyRentalAdvancePayment));
// userRouter.post('/rental-advance/wallet', authenticateOrResolveUser(['user']), asyncHandler(payRentalAdvanceWithWallet));
userRouter.get('/buses/routes', authenticateOrResolveUser(['user']), asyncHandler(getBusRouteSuggestions));
userRouter.get('/buses/search', authenticateOrResolveUser(['user']), asyncHandler(searchBuses));
userRouter.get('/buses/:id/seats', authenticateOrResolveUser(['user']), asyncHandler(getBusSeatLayout));
userRouter.get('/bus-bookings', authenticateOrResolveUser(['user']), asyncHandler(listMyBusBookings));
userRouter.get('/bus-bookings/:id', authenticateOrResolveUser(['user']), asyncHandler(getMyBusBookingById));
userRouter.post('/bus-bookings/:id/review', authenticateOrResolveUser(['user']), asyncHandler(submitMyBusBookingReview));
userRouter.post('/bus-bookings/order', authenticateOrResolveUser(['user']), asyncHandler(createBusBookingOrder));
userRouter.post('/bus-bookings/verify', authenticateOrResolveUser(['user']), asyncHandler(verifyBusBookingPayment));
userRouter.post('/bus-bookings/:id/cancel', authenticateOrResolveUser(['user']), asyncHandler(cancelMyBusBooking));

userRouter.get('/pooling/search', authenticateOrResolveUser(['user']), asyncHandler(searchPoolingRoutes));
userRouter.get('/pooling/routes/:id', authenticateOrResolveUser(['user']), asyncHandler(getPoolingRouteDetails));
userRouter.post('/pooling/bookings/order', authenticateOrResolveUser(['user']), asyncHandler(createPoolingBookingOrder));
userRouter.post('/pooling/bookings/verify', authenticateOrResolveUser(['user']), asyncHandler(verifyPoolingBookingPayment));
userRouter.post('/pooling/bookings', authenticateOrResolveUser(['user']), asyncHandler(createPoolingBooking));
userRouter.get('/pooling/bookings', authenticateOrResolveUser(['user']), asyncHandler(getMyPoolingBookings));
