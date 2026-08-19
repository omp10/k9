import { SetPrice } from '../admin/models/SetPrice.js';
import { Vehicle } from '../admin/models/Vehicle.js';

/**
 * Safe Ride ("drunk mode") pricing.
 *
 * A passenger who has been drinking books a car on a dedicated tariff that the admin
 * configures per vehicle in SetPrice.safe_ride. Everything the rider app, the fare estimate
 * and ride creation need lives here, so an estimate can never disagree with what is charged.
 */

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** Normalises the raw sub-document (which may be absent on older SetPrice rows). */
export const normalizeSafeRideConfig = (setPrice) => {
  const raw = setPrice?.safe_ride || {};
  return {
    enabled: Boolean(raw.enabled),
    base_price: num(raw.base_price),
    base_distance: num(raw.base_distance),
    price_per_distance: num(raw.price_per_distance),
    time_price: num(raw.time_price),
    flat_surcharge: num(raw.flat_surcharge),
    min_fare: num(raw.min_fare),
    note: String(raw.note || '').trim(),
  };
};

/** True when this vehicle+location is configured to offer safe rides. */
export const isSafeRideAvailable = (setPrice) => normalizeSafeRideConfig(setPrice).enabled;

/**
 * Computes a safe-ride fare.
 *
 * Any safe-ride pricing field left at 0 falls back to the vehicle's standard tariff, so an
 * admin can charge only a flat surcharge without restating the whole fare table.
 *
 * @returns {{ fare:number, standardFare:number, surcharge:number, config:object, applied:boolean }}
 */
export const computeSafeRideFare = ({
  pricingRule,
  distanceMeters = 0,
  durationMinutes = 0,
  standardFare = 0,
}) => {
  const config = normalizeSafeRideConfig(pricingRule);
  if (!config.enabled) {
    return { fare: standardFare, standardFare, surcharge: 0, config, applied: false };
  }

  const distanceKm = Math.max(0, Number(distanceMeters) || 0) / 1000;
  const minutes = Math.max(0, Number(durationMinutes) || 0);

  // Fall back to the standard tariff for anything the admin left at 0.
  const basePrice = config.base_price || Math.max(0, Number(pricingRule?.base_price || 0));
  const baseDistance = config.base_distance || Math.max(0, Number(pricingRule?.base_distance || 0));
  const perKm = config.price_per_distance || Math.max(0, Number(pricingRule?.price_per_distance || 0));
  const perMin = config.time_price || Math.max(0, Number(pricingRule?.time_price || 0));
  const taxPercent = Math.max(0, Number(pricingRule?.service_tax || 0));

  const withinBase = baseDistance > 0 && distanceKm <= baseDistance;
  const extraKm = Math.max(0, distanceKm - baseDistance);
  let subtotal = withinBase ? basePrice : basePrice + extraKm * perKm + minutes * perMin;

  subtotal += config.flat_surcharge;
  let total = subtotal + (subtotal * taxPercent) / 100;
  if (config.min_fare > 0) total = Math.max(total, config.min_fare);

  const fare = Math.max(0, Math.round(total));
  return {
    fare,
    standardFare,
    surcharge: Math.max(0, fare - Math.max(0, Number(standardFare) || 0)),
    config,
    applied: true,
  };
};

/**
 * Vehicles offering safe rides for a location/transport type, with an indicative fare.
 * Powers the rider app's "I've been drinking" vehicle list.
 */
export const listSafeRideVehicles = async ({
  serviceLocationId = null,
  transportType = 'taxi',
  distanceMeters = 0,
  durationMinutes = 0,
} = {}) => {
  const query = { 'safe_ride.enabled': true };
  if (serviceLocationId) query.service_location_id = serviceLocationId;
  if (transportType) query.transport_type = transportType;

  const rules = await SetPrice.find(query).lean();
  if (!rules.length) return [];

  const vehicleIds = [...new Set(rules.map((r) => String(r.vehicle_type)).filter(Boolean))];
  const vehicles = await Vehicle.find({ _id: { $in: vehicleIds } })
    .select('name icon icon_types capacity status active')
    .lean();
  const byId = new Map(vehicles.map((v) => [String(v._id), v]));

  return rules
    .map((rule) => {
      const vehicle = byId.get(String(rule.vehicle_type));
      if (!vehicle || vehicle.active === false) return null;

      const standard = computeStandardFare(rule, distanceMeters, durationMinutes);
      const safe = computeSafeRideFare({
        pricingRule: rule,
        distanceMeters,
        durationMinutes,
        standardFare: standard,
      });

      return {
        vehicleTypeId: String(vehicle._id),
        name: vehicle.name,
        icon: vehicle.icon || '',
        iconType: vehicle.icon_types || '',
        capacity: vehicle.capacity || 0,
        standardFare: standard,
        safeRideFare: safe.fare,
        surcharge: safe.surcharge,
        note: safe.config.note,
      };
    })
    .filter(Boolean);
};

/** The standard (non-safe-ride) fare for the same rule, so riders see what the option adds. */
export const computeStandardFare = (rule, distanceMeters = 0, durationMinutes = 0) => {
  const distanceKm = Math.max(0, Number(distanceMeters) || 0) / 1000;
  const minutes = Math.max(0, Number(durationMinutes) || 0);
  const basePrice = Math.max(0, Number(rule?.base_price || 0));
  const baseDistance = Math.max(0, Number(rule?.base_distance || 0));
  const perKm = Math.max(0, Number(rule?.price_per_distance || 0));
  const perMin = Math.max(0, Number(rule?.time_price || 0));
  const taxPercent = Math.max(0, Number(rule?.service_tax || 0));

  const withinBase = baseDistance > 0 && distanceKm <= baseDistance;
  const extraKm = Math.max(0, distanceKm - baseDistance);
  const subtotal = withinBase ? basePrice : basePrice + extraKm * perKm + minutes * perMin;
  if (subtotal <= 0) return 0;
  return Math.max(0, Math.round(subtotal + (subtotal * taxPercent) / 100));
};
