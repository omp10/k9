import { Driver } from '../models/Driver.js';

/**
 * Cross-service busy-lock for a unified driver.
 *
 * A driver may hold exactly ONE active assignment at a time — a taxi ride OR a food delivery.
 * Both dispatchers acquire the lock atomically before assigning, so a driver can never be
 * double-booked across services. Pool rides are the deliberate exception (a driver runs one
 * pool GROUP that holds several rides), so pooled assignment does not use this lock.
 *
 * The lock lives on Driver.activeAssignment: { type:'ride'|'delivery', id, at } | null.
 */

/**
 * Atomically claim the lock. Succeeds only if the driver is currently free (activeAssignment null)
 * OR already holds this exact assignment (idempotent re-acquire). Returns true if the caller holds it.
 */
export const acquireDriverAssignment = async (driverId, type, id, session = null) => {
  if (!driverId || !type || !id) return false;
  const res = await Driver.findOneAndUpdate(
    {
      _id: driverId,
      $or: [
        { activeAssignment: null },
        { activeAssignment: { $exists: false } },
        { 'activeAssignment.type': type, 'activeAssignment.id': id },
      ],
    },
    { $set: { activeAssignment: { type, id, at: new Date() } } },
    { new: true, session },
  );
  return Boolean(res);
};

/**
 * Release the lock, but only if it still points at THIS assignment — so a stale release
 * (late completion of an old ride) can't clear a lock that a newer assignment already took.
 */
export const releaseDriverAssignment = async (driverId, id, session = null) => {
  if (!driverId || !id) return false;
  const res = await Driver.updateOne(
    { _id: driverId, 'activeAssignment.id': id },
    { $set: { activeAssignment: null } },
    { session },
  );
  return Boolean(res?.modifiedCount);
};

/** Force-clear the lock regardless of what it holds (admin/recovery use only). */
export const forceClearDriverAssignment = async (driverId, session = null) => {
  if (!driverId) return false;
  const res = await Driver.updateOne(
    { _id: driverId },
    { $set: { activeAssignment: null } },
    { session },
  );
  return Boolean(res?.modifiedCount);
};

const TERMINAL_RIDE_STATUSES = ['completed', 'cancelled'];
const TERMINAL_ORDER_STATUSES = [
  'delivered',
  'cancelled_by_user',
  'cancelled_by_restaurant',
  'cancelled_by_admin',
];

/**
 * Self-heal a stale busy-lock.
 *
 * A lock can outlive its job — the driver force-quits mid-delivery, a release is missed on an
 * unusual exit path, or the job is cancelled by a flow that doesn't route through the normal
 * terminal handlers. Without this the driver is permanently unassignable.
 *
 * Looks up whatever the lock points at and clears it if that job is gone or already terminal.
 * A lock on a genuinely live job is left alone. Safe to call often; only writes when stale.
 *
 * @returns {Promise<boolean>} true if a stale lock was cleared
 */
export const reconcileDriverAssignment = async (driverId) => {
  if (!driverId) return false;

  const driver = await Driver.findById(driverId).select('activeAssignment').lean();
  const assignment = driver?.activeAssignment;
  if (!assignment?.type || !assignment?.id) return false;

  let isStale = false;

  try {
    if (assignment.type === 'ride') {
      const { Ride } = await import('../../user/models/Ride.js');
      const ride = await Ride.findById(assignment.id).select('status').lean();
      isStale = !ride || TERMINAL_RIDE_STATUSES.includes(String(ride.status || '').toLowerCase());
    } else if (assignment.type === 'delivery') {
      const { FoodOrder } = await import('../../../food/orders/models/order.model.js');
      const order = await FoodOrder.findById(assignment.id).select('orderStatus').lean();
      isStale = !order || TERMINAL_ORDER_STATUSES.includes(String(order.orderStatus || '').toLowerCase());
    } else {
      isStale = true; // unknown type — don't strand the driver
    }
  } catch {
    return false; // lookup failed: leave the lock alone rather than freeing a live job
  }

  if (!isStale) return false;

  // Clear only if the lock still points at the same job we just judged stale.
  const res = await Driver.updateOne(
    { _id: driverId, 'activeAssignment.id': assignment.id },
    { $set: { activeAssignment: null } },
  );
  return Boolean(res?.modifiedCount);
};
