/**
 * Inspect (and optionally zero) a delivery partner's wallet.
 *
 *   node scripts/delivery-wallet.js <phone>                 # read-only
 *   node scripts/delivery-wallet.js <phone> --set-cash 0    # set cashInHand
 *   node scripts/delivery-wallet.js <phone> --set-balance 0 # set balance
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
dotenv.config();

const phoneArg = process.argv[2];
if (!phoneArg) { console.error('usage: node scripts/delivery-wallet.js <phone> [--set-cash N] [--set-balance N]'); process.exit(1); }
const last10 = String(phoneArg).replace(/\D/g, '').slice(-10);

const idx = (f) => { const i = process.argv.indexOf(f); return i === -1 ? null : Number(process.argv[i + 1]); };
const setCash = idx('--set-cash');
const setBalance = idx('--set-balance');

await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
const { FoodDeliveryPartner } = await import('../src/modules/food/delivery/models/deliveryPartner.model.js');
const { FoodDeliveryWallet } = await import('../src/modules/food/delivery/models/deliveryWallet.model.js');

const p = await FoodDeliveryPartner.findOne({ phone: { $regex: `${last10}$` } }).lean();
if (!p) { console.log(`No delivery partner found for phone ending ${last10}`); await mongoose.disconnect(); process.exit(1); }
console.log(`partner: ${p.name} (${p.phone})  id=${p._id}  status=${p.status}`);

const { getDeliveryPartnerWalletEnhanced } = await import('../src/modules/food/delivery/services/deliveryFinance.service.js');
const enh = await getDeliveryPartnerWalletEnhanced(p._id);
console.log('DERIVED WALLET:');
console.log('  cashInHand        =', enh.cashInHand);
console.log('  availableCashLimit=', enh.availableCashLimit);
console.log('  totalEarned       =', enh.totalEarned ?? enh.balance);
console.log('  availabilityStatus=', p.availabilityStatus);
console.log('  lastLocation      =', JSON.stringify(p.lastLocation||null), ' lastLocationAt=', p.lastLocationAt);
const { FoodOrder } = await import('../src/modules/food/orders/models/order.model.js');
const recent = await FoodOrder.find({}).sort({createdAt:-1}).limit(8).select('order_id orderStatus dispatch pricing.total payment.method payment.status createdAt').lean();
console.log('RECENT ORDERS (newest first):');
recent.forEach(o=>console.log());
await mongoose.disconnect();
process.exit(0);

const show = (label, doc) => console.log(
  `${label} balance=${doc.balance} cashInHand=${doc.cashInHand} locked=${doc.lockedAmount} ` +
  `earnings=${doc.totalEarnings} settled=${doc.totalSettled} deliveries=${doc.totalDeliveries}`
);
show('BEFORE:', w);

const patch = {};
if (setCash !== null && Number.isFinite(setCash)) patch.cashInHand = setCash;
if (setBalance !== null && Number.isFinite(setBalance)) patch.balance = setBalance;

if (Object.keys(patch).length) {
  await FoodDeliveryWallet.updateOne({ _id: w._id }, { $set: patch });
  w = await FoodDeliveryWallet.findById(w._id);
  console.log('applied:', JSON.stringify(patch));
  show('AFTER: ', w);
} else {
  console.log('(read-only — pass --set-cash / --set-balance to change)');
}

await mongoose.disconnect();
