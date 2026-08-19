import { listSafeRideVehicles } from '../../services/safeRideService.js';
import { ApiError } from '../../../../utils/ApiError.js';

/**
 * GET /taxi/users/safe-ride/vehicles
 *
 * Vehicles offering a Safe Ride for this trip, with both the normal fare and the safe-ride
 * fare so the rider can see exactly what the option costs before choosing it.
 *
 * Query: serviceLocationId?, transportType?, distanceMeters?, durationMinutes?
 */
export const getSafeRideVehicles = async (req, res) => {
  const distanceMeters = Number(req.query.distanceMeters || 0);
  const durationMinutes = Number(req.query.durationMinutes || 0);
  if (distanceMeters < 0 || durationMinutes < 0) {
    throw new ApiError(400, 'distanceMeters and durationMinutes must be >= 0');
  }

  const vehicles = await listSafeRideVehicles({
    serviceLocationId: req.query.serviceLocationId || null,
    transportType: String(req.query.transportType || 'taxi'),
    distanceMeters,
    durationMinutes,
  });

  res.json({
    success: true,
    message: vehicles.length ? 'Safe ride vehicles retrieved' : 'No safe ride vehicles available here',
    data: {
      available: vehicles.length > 0,
      vehicles,
    },
  });
};
