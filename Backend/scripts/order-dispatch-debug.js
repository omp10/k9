/** Read-only: why isn't an order reaching delivery partners? */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
dotenv.config();

await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
const { FoodOrder } = await import('../src/modules/food/orders/models/order.model.js');
const { FoodDeliveryPartner } = await import('../src/modules/food/delivery/models/deliveryPartner.model.js');
const { FoodFeeSettings } = await import('../src/modules/food/admin/models/feeSettings.model.js');

const recent = await FoodOrder.find({})
  .sort({ createdAt: -1 }).limit(8)
  .select('order_id orderStatus dispatch pricing.total payment.method payment.status createdAt')
  .lean();

console.log('RECENT ORDERS (newest first):');
for (const o of recent) {
  const d = o.dispatch || {};
  console.log(
    '  ' + (o.order_id || o._id) +
    '  status=' + o.orderStatus +
    '  pay=' + (o.payment?.method || '?') + '/' + (o.payment?.status || '?') +
    '  total=' + (o.pricing?.total ?? '?') +
    '  dispatch=' + (d.status || '-') +
    '  partner=' + (d.deliveryPartnerId || '-') +
    '  offeredTo=' + (Array.isArray(d.offeredTo) ? d.offeredTo.length : 0)
  );
}

const dispatchable = await FoodOrder.countDocuments({
  'dispatch.status': 'unassigned',
  orderStatus: { $in: ['confirmed', 'preparing', 'ready_for_pickup'] },
});
console.log('\nDISPATCHABLE RIGHT NOW:', dispatchable);

const online = await FoodDeliveryPartner.find({ availabilityStatus: 'online' })
  .select('name phone status lastLocationAt').lean();
console.log('ONLINE PARTNERS:', online.length);
online.forEach((p) => console.log('  ' + p.name + ' (' + p.phone + ') status=' + p.status + ' lastSeen=' + p.lastLocationAt));

const fee = await FoodFeeSettings.findOne({ isActive: true }).sort({ createdAt: -1 }).lean();
console.log('\nSETTINGS: codOrderLimit =', fee?.codOrderLimit, ' deliveryFeeMode =', fee?.deliveryFeeComputationMode);

await mongoose.disconnect();
