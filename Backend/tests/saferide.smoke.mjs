/**
 * Safe Ride ("drunk mode") pricing: admin toggle + per-vehicle tariff.
 * Isolated in-memory MongoDB; never touches Atlas.
 *   node tests/saferide.smoke.mjs
 */
import assert from 'assert';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const results = [];
const test = async (name, fn) => {
  try { await fn(); results.push({ ok: true }); console.log('  PASS  ' + name); }
  catch (err) { results.push({ ok: false }); console.log('  FAIL  ' + name + '\n        ' + err.message); }
};
const oid = () => new mongoose.Types.ObjectId();

async function main() {
  process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
  console.log('Booting in-memory MongoDB replica set...');
  const rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(rs.getUri(), { dbName: 'saferide' });
  console.log('Connected.\n');

  const { computeSafeRideFare, normalizeSafeRideConfig, listSafeRideVehicles } =
    await import('../src/modules/taxi/services/safeRideService.js');
  const { SetPrice } = await import('../src/modules/taxi/admin/models/SetPrice.js');
  const { Vehicle } = await import('../src/modules/taxi/admin/models/Vehicle.js');

  // 10 km / 20 min. Standard fare: 50 + 9*8 + 20*1 = 142
  const rule = {
    base_price: 50, base_distance: 1, price_per_distance: 8, time_price: 1, service_tax: 0,
    safe_ride: {
      enabled: true, base_price: 100, base_distance: 1, price_per_distance: 12,
      time_price: 2, flat_surcharge: 50, min_fare: 0,
    },
  };
  const D = 10000;
  const M = 20;

  console.log('Fare computation');

  await test('disabled config leaves the fare untouched', async () => {
    const r = computeSafeRideFare({
      pricingRule: { ...rule, safe_ride: { enabled: false } },
      distanceMeters: D, durationMinutes: M, standardFare: 142,
    });
    assert.equal(r.applied, false);
    assert.equal(r.fare, 142);
    assert.equal(r.surcharge, 0);
  });

  await test('enabled config uses the dedicated tariff and reports the surcharge', async () => {
    const r = computeSafeRideFare({ pricingRule: rule, distanceMeters: D, durationMinutes: M, standardFare: 142 });
    // 100 + 9*12 + 20*2 = 248, + 50 flat = 298
    assert.equal(r.applied, true);
    assert.equal(r.fare, 298, 'expected 298, got ' + r.fare);
    assert.equal(r.surcharge, 298 - 142);
  });

  await test('omitted safe-ride fields fall back to the standard tariff', async () => {
    const onlySurcharge = { ...rule, safe_ride: { enabled: true, flat_surcharge: 50 } };
    const r = computeSafeRideFare({ pricingRule: onlySurcharge, distanceMeters: D, durationMinutes: M, standardFare: 142 });
    assert.equal(r.fare, 192, 'expected 192, got ' + r.fare);
  });

  await test('min_fare raises a cheap trip but never lowers an expensive one', async () => {
    const withMin = { ...rule, safe_ride: { enabled: true, flat_surcharge: 0, min_fare: 500 } };
    const short = computeSafeRideFare({ pricingRule: withMin, distanceMeters: 500, durationMinutes: 2, standardFare: 50 });
    assert.equal(short.fare, 500, 'floor applied');

    const long = computeSafeRideFare({
      pricingRule: { ...rule, safe_ride: { enabled: true, min_fare: 10 } },
      distanceMeters: D, durationMinutes: M, standardFare: 142,
    });
    assert.ok(long.fare > 10, 'floor never reduces a higher fare');
  });

  await test('service tax is applied on top', async () => {
    const taxed = { ...rule, service_tax: 10, safe_ride: { enabled: true, flat_surcharge: 100 } };
    const r = computeSafeRideFare({ pricingRule: taxed, distanceMeters: D, durationMinutes: M, standardFare: 0 });
    // subtotal 142 + 100 = 242, +10% = 266.2 -> 266
    assert.equal(r.fare, 266, 'expected 266, got ' + r.fare);
  });

  await test('never returns a negative fare or surcharge', async () => {
    const r = computeSafeRideFare({
      pricingRule: { ...rule, safe_ride: { enabled: true, flat_surcharge: 0 } },
      distanceMeters: 0, durationMinutes: 0, standardFare: 9999,
    });
    assert.ok(r.fare >= 0);
    assert.ok(r.surcharge >= 0, 'surcharge floors at 0 when the safe fare is cheaper');
  });

  await test('legacy rows without safe_ride are treated as disabled', async () => {
    const cfg = normalizeSafeRideConfig({ base_price: 10 });
    assert.equal(cfg.enabled, false);
    const r = computeSafeRideFare({ pricingRule: { base_price: 10 }, distanceMeters: D, durationMinutes: M, standardFare: 77 });
    assert.equal(r.applied, false);
    assert.equal(r.fare, 77);
  });

  console.log('\nPersistence + vehicle listing');

  await test('config round-trips through MongoDB', async () => {
    const doc = await SetPrice.create({
      service_location_id: oid(), transport_type: 'taxi', vehicle_type: oid(),
      base_price: 50, base_distance: 1, price_per_distance: 8, time_price: 1,
      safe_ride: { enabled: true, base_price: 100, flat_surcharge: 50, note: 'Trained driver' },
    });
    const cfg = normalizeSafeRideConfig(await SetPrice.findById(doc._id).lean());
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.base_price, 100);
    assert.equal(cfg.flat_surcharge, 50);
    assert.equal(cfg.note, 'Trained driver');
  });

  await test('listing returns only enabled vehicles, with both fares', async () => {
    const loc = oid();
    const onV = await Vehicle.create({ name: 'Safe Sedan', transport_type: 'taxi', icon_types: 'car', active: true });
    const offV = await Vehicle.create({ name: 'Plain Hatch', transport_type: 'taxi', icon_types: 'car', active: true });
    await SetPrice.create({
      service_location_id: loc, transport_type: 'taxi', vehicle_type: onV._id,
      base_price: 50, base_distance: 1, price_per_distance: 8, time_price: 1,
      safe_ride: { enabled: true, flat_surcharge: 60 },
    });
    await SetPrice.create({
      service_location_id: loc, transport_type: 'taxi', vehicle_type: offV._id,
      base_price: 50, base_distance: 1, price_per_distance: 8, time_price: 1,
      safe_ride: { enabled: false },
    });

    const list = await listSafeRideVehicles({ serviceLocationId: loc, transportType: 'taxi', distanceMeters: D, durationMinutes: M });
    assert.equal(list.length, 1, 'expected 1 vehicle, got ' + list.length);
    assert.equal(list[0].name, 'Safe Sedan');
    assert.equal(list[0].standardFare, 142);
    assert.equal(list[0].safeRideFare, 202, 'expected 202, got ' + list[0].safeRideFare);
    assert.equal(list[0].surcharge, 60);
  });

  await test('inactive vehicles are hidden even when priced', async () => {
    const loc = oid();
    const v = await Vehicle.create({ name: 'Retired Car', transport_type: 'taxi', icon_types: 'car', active: false });
    await SetPrice.create({
      service_location_id: loc, transport_type: 'taxi', vehicle_type: v._id,
      base_price: 50, safe_ride: { enabled: true, flat_surcharge: 10 },
    });
    const list = await listSafeRideVehicles({ serviceLocationId: loc, transportType: 'taxi', distanceMeters: D, durationMinutes: M });
    assert.equal(list.length, 0);
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
