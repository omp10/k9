import { SetPrice } from '../models/SetPrice.js';
import { Vehicle } from '../models/Vehicle.js';
import { ApiError } from '../../../../utils/ApiError.js';
import { normalizeSafeRideConfig } from '../../services/safeRideService.js';

/**
 * Admin management of Safe Ride ("drunk mode"): which vehicles offer it and at what price.
 * Config lives on SetPrice, so it is already scoped per service location + transport type +
 * vehicle — an admin toggles it on exactly the vehicles they want and prices each separately.
 */

const toMoney = (value, field) => {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new ApiError(400, `${field} must be a number >= 0`);
  }
  return Math.round(n * 100) / 100;
};

/** GET /taxi/admin/safe-ride/pricing — every priced vehicle with its safe-ride config. */
export const listSafeRidePricing = async (req, res) => {
  const filter = {};
  if (req.query.serviceLocationId) filter.service_location_id = req.query.serviceLocationId;
  if (req.query.transportType) filter.transport_type = req.query.transportType;
  if (String(req.query.enabledOnly || '') === 'true') filter['safe_ride.enabled'] = true;

  const rules = await SetPrice.find(filter).lean();
  const vehicleIds = [...new Set(rules.map((r) => String(r.vehicle_type)).filter(Boolean))];
  const vehicles = await Vehicle.find({ _id: { $in: vehicleIds } })
    .select('name icon icon_types active')
    .lean();
  const byId = new Map(vehicles.map((v) => [String(v._id), v]));

  const data = rules.map((rule) => {
    const v = byId.get(String(rule.vehicle_type));
    return {
      setPriceId: String(rule._id),
      vehicleTypeId: String(rule.vehicle_type || ''),
      vehicleName: v?.name || 'Unknown vehicle',
      vehicleIcon: v?.icon || '',
      vehicleActive: v?.active !== false,
      serviceLocationId: rule.service_location_id ? String(rule.service_location_id) : null,
      transportType: rule.transport_type || '',
      standardTariff: {
        base_price: rule.base_price || 0,
        base_distance: rule.base_distance || 0,
        price_per_distance: rule.price_per_distance || 0,
        time_price: rule.time_price || 0,
      },
      safeRide: normalizeSafeRideConfig(rule),
    };
  });

  res.json({ success: true, message: 'Safe ride pricing retrieved', data });
};

/**
 * PUT /taxi/admin/safe-ride/pricing/:setPriceId
 * Toggles Safe Ride for one vehicle and sets its dedicated tariff.
 * Only the supplied fields change; omitted ones keep their current value.
 */
export const updateSafeRidePricing = async (req, res) => {
  const rule = await SetPrice.findById(req.params.setPriceId);
  if (!rule) throw new ApiError(404, 'Pricing rule not found');

  const body = req.body || {};
  const current = normalizeSafeRideConfig(rule);
  const next = { ...current };

  if (body.enabled !== undefined) next.enabled = Boolean(body.enabled);
  for (const field of ['base_price', 'base_distance', 'price_per_distance', 'time_price', 'flat_surcharge', 'min_fare']) {
    const parsed = toMoney(body[field], field);
    if (parsed !== undefined) next[field] = parsed;
  }
  if (body.note !== undefined) next.note = String(body.note).slice(0, 200).trim();

  // Enabling with no pricing at all would silently charge the standard fare and the rider
  // would see a "Safe Ride" option that costs the same — reject it rather than mislead.
  if (next.enabled) {
    const hasPricing = ['base_price', 'price_per_distance', 'time_price', 'flat_surcharge', 'min_fare']
      .some((f) => next[f] > 0);
    if (!hasPricing) {
      throw new ApiError(400, 'Set at least one safe-ride price (or a flat surcharge) before enabling it');
    }
  }

  rule.safe_ride = next;
  await rule.save();

  res.json({
    success: true,
    message: next.enabled ? 'Safe Ride enabled' : 'Safe Ride disabled',
    data: { setPriceId: String(rule._id), safeRide: normalizeSafeRideConfig(rule) },
  });
};

/** PATCH /taxi/admin/safe-ride/pricing/bulk-toggle — turn it on/off for several vehicles at once. */
export const bulkToggleSafeRide = async (req, res) => {
  const ids = Array.isArray(req.body?.setPriceIds) ? req.body.setPriceIds : [];
  if (!ids.length) throw new ApiError(400, 'setPriceIds is required');
  const enabled = Boolean(req.body?.enabled);

  // Turning ON in bulk must not create options that cost the same as a normal ride.
  if (enabled) {
    const rules = await SetPrice.find({ _id: { $in: ids } }).lean();
    const unpriced = rules.filter((r) => {
      const c = normalizeSafeRideConfig(r);
      return !['base_price', 'price_per_distance', 'time_price', 'flat_surcharge', 'min_fare'].some((f) => c[f] > 0);
    });
    if (unpriced.length) {
      throw new ApiError(400, `${unpriced.length} of the selected vehicles have no safe-ride pricing set`);
    }
  }

  const result = await SetPrice.updateMany(
    { _id: { $in: ids } },
    { $set: { 'safe_ride.enabled': enabled } },
  );
  res.json({
    success: true,
    message: `Safe Ride ${enabled ? 'enabled' : 'disabled'} for ${result.modifiedCount} vehicle(s)`,
    data: { modified: result.modifiedCount },
  });
};
