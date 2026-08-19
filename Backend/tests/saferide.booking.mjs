/**
 * Safe Ride END-TO-END through the real booking path.
 *
 * The pricing unit tests prove the maths; this proves createRideRecord actually applies the
 * safe-ride tariff, persists the flag/snapshot on the ride, and refuses the option when the
 * admin has not enabled it for that vehicle. Isolated in-memory MongoDB; never touches Atlas.
 *
 *   node tests/saferide.booking.mjs
 */
import assert from 'assert';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const results = [];
const test = async (name, fn) => {
  try { await fn(); results.push({ ok: true }); console.log('  PASS  ' + name); }
  catch (err) { results.push({ ok: false }); console.log('  FAIL  ' + name + '\n        ' + err.message); }
};

async function main() {
  process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
  process.env.JWT_ACCESS_SECRET ||= 'test';
  process.env.JWT_REFRESH_SECRET ||= 'test';
  console.log('Booting in-memory MongoDB replica set...');
  const rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  process.env.MONGODB_URI = rs.getUri();
  process.env.MONGO_URI = rs.getUri();
  await mongoose.connect(rs.getUri(), { dbName: 'srbooking' });
  console.log('Connected.\n');

  const { createRideRecord } = await import('../src/modules/taxi/services/rideService.js');
  const { SetPrice } = await import('../src/modules/taxi/admin/models/SetPrice.js');
  const { Vehicle } = await import('../src/modules/taxi/admin/models/Vehicle.js');
  const { Ride } = await import('../src/modules/taxi/user/models/Ride.js');
  const { User } = await import('../src/modules/taxi/user/models/User.js');

  const user = await User.create({ name: 'Rider', phone: '9000000001' });

  const mkVehicle = async (name) =>
    Vehicle.create({ name, transport_type: 'taxi', icon_types: 'car', active: true, capacity: 4 });

  // 10 km / 20 min. Standard: 50 + 9*8 + 20*1 = 142
  const basePricing = {
    transport_type: 'taxi', base_price: 50, base_distance: 1,
    price_per_distance: 8, time_price: 1, service_tax: 0,
  };

  const book = (over = {}) => createRideRecord({
    userId: String(user._id),
    pickupCoords: [72.5, 23.0],
    dropCoords: [72.6, 23.1],
    pickupAddress: 'A', dropAddress: 'B',
    fare: 0,
    estimatedDistanceMeters: 10000,
    estimatedDurationMinutes: 20,
    paymentMethod: 'cash',
    serviceType: 'ride',
    transport_type: 'taxi',
    ...over,
  });

  console.log('Booking path');

  await test('booking WITHOUT the option charges the standard fare', async () => {
    const v = await mkVehicle('Std Car');
    await SetPrice.create({ ...basePricing, vehicle_type: v._id, safe_ride: { enabled: true, flat_surcharge: 120 } });
    const ride = await book({ vehicleTypeId: String(v._id) });
    assert.equal(ride.fare, 142, 'expected standard 142, got ' + ride.fare);
    assert.equal(ride.safeRide?.isSafeRide, false, 'flag must be false');
    assert.equal(ride.safeRide?.surchargeAmount, 0);
  });

  await test('booking WITH the option charges the safe-ride tariff', async () => {
    const v = await mkVehicle('Safe Car');
    await SetPrice.create({ ...basePricing, vehicle_type: v._id, safe_ride: { enabled: true, flat_surcharge: 120 } });
    const ride = await book({ vehicleTypeId: String(v._id), safeRide: true });
    assert.equal(ride.fare, 262, 'expected 142+120=262, got ' + ride.fare);
    assert.equal(ride.safeRide.isSafeRide, true);
    assert.equal(ride.safeRide.surchargeAmount, 120, 'surcharge recorded');
    assert.ok(ride.safeRide.acknowledgedAt, 'consent timestamp recorded');
    assert.ok(ride.safeRide.pricingSnapshot, 'tariff snapshot recorded');
  });

  await test('the safe fare and flag survive a DB round-trip', async () => {
    const v = await mkVehicle('Persist Car');
    await SetPrice.create({ ...basePricing, vehicle_type: v._id, safe_ride: { enabled: true, flat_surcharge: 90 } });
    const ride = await book({ vehicleTypeId: String(v._id), safeRide: true });
    const fresh = await Ride.findById(ride._id).lean();
    assert.equal(fresh.fare, 232, 'expected 232, got ' + fresh.fare);
    assert.equal(fresh.safeRide.isSafeRide, true);
    assert.equal(fresh.safeRide.surchargeAmount, 90);
    assert.equal(fresh.safeRide.pricingSnapshot.flat_surcharge, 90, 'snapshot kept the tariff used');
  });

  await test('requesting it on a vehicle where it is DISABLED is refused', async () => {
    const v = await mkVehicle('No Safe Car');
    await SetPrice.create({ ...basePricing, vehicle_type: v._id, safe_ride: { enabled: false } });
    await assert.rejects(
      () => book({ vehicleTypeId: String(v._id), safeRide: true }),
      (err) => /not available/i.test(err.message),
      'must reject rather than silently charge the standard fare',
    );
  });

  await test('a later admin price change does not rewrite an existing ride', async () => {
    const v = await mkVehicle('Snapshot Car');
    const sp = await SetPrice.create({ ...basePricing, vehicle_type: v._id, safe_ride: { enabled: true, flat_surcharge: 70 } });
    const ride = await book({ vehicleTypeId: String(v._id), safeRide: true });
    const bookedFare = ride.fare;

    await SetPrice.updateOne({ _id: sp._id }, { $set: { 'safe_ride.flat_surcharge': 999 } });

    const fresh = await Ride.findById(ride._id).lean();
    assert.equal(fresh.fare, bookedFare, 'historic fare unchanged');
    assert.equal(fresh.safeRide.pricingSnapshot.flat_surcharge, 70, 'snapshot still shows what was charged');
  });

  const failed = results.filter((r) => !r.ok).length;
  console.log('\n' + (results.length - failed) + '/' + results.length + ' passed');
  await mongoose.disconnect().catch(() => {});
  await rs.stop().catch(() => {});
  return failed;
}

let code = 1;
try { code = await main(); } catch (e) { console.error('Harness error:', e); code = 1; }
process.exit(code === 0 ? 0 : 1);
