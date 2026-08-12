/** Read-only: who was a given order offered to, and why not the others? */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
dotenv.config();

const orderRef = process.argv[2];
await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
const { FoodOrder } = await import('../src/modules/food/orders/models/order.model.js');
const { FoodDeliveryPartner } = await import('../src/modules/food/delivery/models/deliveryPartner.model.js');
const { FoodRestaurant } = await import('../src/modules/food/restaurant/models/restaurant.model.js');

const o = await FoodOrder.findOne(orderRef ? { order_id: orderRef } : {
  'dispatch.status': 'unassigned',
  orderStatus: { $in: ['confirmed', 'preparing', 'ready_for_pickup'] },
}).sort({ createdAt: -1 }).lean();

if (!o) { console.log('no matching order'); await mongoose.disconnect(); process.exit(0); }

console.log('ORDER', o.order_id, 'status=' + o.orderStatus, 'dispatch=' + o.dispatch?.status, 'mode=' + o.dispatch?.modeAtCreation);
console.log('total=', o.pricing?.total, ' pay=', o.payment?.method);

const rest = await FoodRestaurant.findById(o.restaurantId).select('restaurantName location').lean();
console.log('restaurant:', rest?.restaurantName, JSON.stringify(rest?.location?.coordinates || null));

const offered = o.dispatch?.offeredTo || [];
console.log('\nOFFERED TO (' + offered.length + '):');
for (const off of offered) {
  const p = await FoodDeliveryPartner.findById(off.deliveryPartnerId || off.partnerId || off)
    .select('name phone availabilityStatus lastLocationAt lastLat lastLng').lean();
  console.log('  ' + (p ? p.name + ' (' + p.phone + ')' : String(off.deliveryPartnerId || off)) +
    '  status=' + (off.status || '-') + '  online=' + (p?.availabilityStatus || '?') +
    '  lastSeen=' + (p?.lastLocationAt || '?'));
}

console.log('\nALL ONLINE PARTNERS + distance to restaurant:');
const R = 6371;
const [rLng, rLat] = rest?.location?.coordinates || [];
const partners = await FoodDeliveryPartner.find({ availabilityStatus: 'online' })
  .select('name phone lastLat lastLng lastLocationAt status').lean();
for (const p of partners) {
  let dist = 'n/a';
  if (Number.isFinite(rLat) && Number.isFinite(p.lastLat)) {
    const dLat = (p.lastLat - rLat) * Math.PI / 180;
    const dLon = (p.lastLng - rLng) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(rLat * Math.PI / 180) * Math.cos(p.lastLat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    dist = (R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(2) + ' km';
  }
  const ageMin = p.lastLocationAt ? Math.round((Date.now() - new Date(p.lastLocationAt).getTime()) / 60000) : null;
  console.log('  ' + p.name + ' (' + p.phone + ')  dist=' + dist + '  gpsAgeMin=' + ageMin + '  status=' + p.status);
}

await mongoose.disconnect();
