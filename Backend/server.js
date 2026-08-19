import './src/config/env.js';
import http from 'http';
import crypto from 'crypto';
import { exec } from 'child_process';
import mongoose from 'mongoose';
import app from './src/app.js';

import { config } from './src/config/env.js';
import { validateConfig } from './src/config/validateEnv.js';
import { connectDB, disconnectDB } from './src/config/db.js';
import { connectRedis, closeRedis } from './src/config/redis.js';
import { initSocket } from './src/config/socket.js';
import { initializeQueues, closeBullMQConnection } from './src/queues/index.js';
import { expireExpiredOffers } from './src/modules/food/admin/services/admin.service.js';
import { syncExpiredFssaiNotifications } from './src/modules/food/restaurant/services/fssaiExpiry.service.js';

import { logger } from './src/utils/logger.js';
import { initializeFirebaseRealtime } from './src/config/firebase.js';

const SHUTDOWN_TIMEOUT_MS = 10000;
let server = null;
let expireOffersInterval = null;
let fssaiExpiryInterval = null;

const gracefulShutdown = async (signal) => {
    logger.info(`${signal} received, starting graceful shutdown`);
    if (!server) {
        process.exit(0);
        return;
    }
    server.close(async () => {
        try {
            await disconnectDB();
            await closeRedis();
            await closeBullMQConnection();
            if (expireOffersInterval) clearInterval(expireOffersInterval);
            if (fssaiExpiryInterval) clearInterval(fssaiExpiryInterval);
            logger.info('Graceful shutdown complete');
            process.exit(0);
        } catch (err) {
            logger.error(`Shutdown error: ${err.message}`);
            process.exit(1);
        }
    });
    setTimeout(() => {
        logger.error('Shutdown timeout, forcing exit');
        process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
};

const startServer = async () => {
    try {
        validateConfig();
        initializeFirebaseRealtime();

        // 1. Connect to Database (MongoDB) - Asynchronously to prevent blocking startup
        connectDB().catch((err) => {
            logger.error(`Failed to connect to MongoDB: ${err.message}`);
        });

        // 2. Create HTTP server from Express app
        const httpServer = http.createServer(app);

        // 3. Initialize Socket.IO with the HTTP server (Redis adapter when Redis enabled)
        await initSocket(httpServer);

        // 3b. Initialize Taxi Module Socket handlers on the same IO instance
        const { getIO } = await import('./src/config/socket.js');
        const { configureTaxiSocketServer } = await import('./src/modules/taxi/socket/index.js');
        configureTaxiSocketServer(getIO());

        if (config.redisEnabled) {
            await connectRedis();
        }

        // 5a. Watchdog: Recover stuck orders from previous run
        const runWatchdog = async () => {
            try {
                const { recoverStuckOrders } = await import('./src/modules/food/orders/services/order.service.js');
                await recoverStuckOrders();
            } catch (err) {
                logger.error(`Watchdog startup error: ${err.message}`);
            }
        };

        const ensureBusDaysUpdated = async () => {
            try {
                const { BusService } = await import('./src/modules/taxi/admin/models/BusService.js');
                await BusService.updateMany(
                    { operatorName: "K9 Travels" },
                    {
                        $set: {
                            "schedules.$[].activeDays": ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
                        }
                    }
                );
                logger.info('Database settings: Bus schedules active days updated to short codes!');
            } catch (err) {
                logger.error(`Error updating bus days: ${err.message}`);
            }
        };

        const seedBusDriverInDb = async () => {
            try {
                const { BusDriver } = await import('./src/modules/taxi/driver/models/BusDriver.js');
                const { BusService } = await import('./src/modules/taxi/admin/models/BusService.js');

                const bus = await BusService.findOne({ registrationNumber: "MP04AB9999" });
                if (bus) {
                    const phone = "7000123456";
                    let driver = await BusDriver.findOne({ phone });
                    if (!driver) {
                        driver = new BusDriver({ phone });
                    }
                    driver.name = "Rajesh Kumar";
                    driver.email = "rajesh.driver@k9rides.com";
                    driver.approve = true;
                    driver.active = true;
                    driver.status = "approved";
                    driver.assignedBusServiceId = bus._id;
                    driver.operatorName = bus.operatorName || "K9 Travels";
                    driver.busName = bus.busName || "Sleeper Premium AC";
                    driver.serviceNumber = bus.serviceNumber || "K9-1002";
                    driver.registrationNumber = bus.registrationNumber || "MP04AB9999";
                    driver.routeName = bus.route?.routeName || "Bhopal - Indore";
                    driver.originCity = bus.route?.originCity || "Bhopal";
                    driver.destinationCity = bus.route?.destinationCity || "Indore";
                    await driver.save();

                    bus.driverName = driver.name;
                    bus.driverPhone = driver.phone;
                    bus.busDriverId = driver._id;
                    await bus.save();
                    logger.info('Database settings: Bus Driver seeded and linked to bus successfully!');
                } else {
                    logger.warn('Database settings: Seeded bus not found, cannot link driver.');
                }
            } catch (err) {
                logger.error(`Error seeding bus driver: ${err.message}`);
            }
        };

        if (mongoose.connection.readyState === 1) {
            runWatchdog();
            ensureBusDaysUpdated();
            seedBusDriverInDb();
        } else {
            mongoose.connection.once('connected', () => {
                runWatchdog();
                ensureBusDaysUpdated();
                seedBusDriverInDb();
            });
        }

        // 5. Conditionally initialize BullMQ queues.
        // BullMQ requires Redis; skip queue bootstrap when Redis is disabled.
        if (config.bullmqEnabled && config.redisEnabled) {
            try {
                initializeQueues();
            } catch (err) {
                logger.error(`BullMQ initialization error (server continues): ${err.message}`);
            }
        } else if (config.bullmqEnabled && !config.redisEnabled) {
            logger.warn('BullMQ is enabled but Redis is disabled. Queue initialization skipped.');
        }

        app.post('/api/debug-log', (req, res) => {
            console.log("[FRONTEND_LOG]", req.body.message);
            import('fs').then(fs => {
                fs.appendFileSync('s:/Appezeto task-2/k9rides/Backend/scratch_socket_debug.log', `${new Date().toISOString()} [FRONTEND_LOG] ${req.body.message}\n`);
            }).catch(err => console.error(err));
            res.sendStatus(200);
        });

        app.post('/api/deploy', (req, res) => {
            const signature = req.headers['x-hub-signature-256'];
            const secret = process.env.DEPLOY_WEBHOOK_SECRET;

            if (!secret) {
                logger.error('DEPLOY_WEBHOOK_SECRET is not configured. Webhook deployment request rejected.');
                return res.status(500).send('Deploy webhook secret is not configured.');
            }

            const hash = 'sha256=' + crypto
                .createHmac('sha256', secret)
                .update(JSON.stringify(req.body))
                .digest('hex');

            if (signature !== hash) {
                return res.status(403).send('Unauthorized');
            }

            exec('cd ~ && ./deploy.sh', (err, stdout, stderr) => {
                if (err) {
                    console.error(err);
                    return res.send('Deploy failed');
                }

                console.log(stdout);
                res.send('Deploy success');
            });
        });

        // 6. Start the HTTP server - Bind immediately to PORT
        const PORT = process.env.PORT || 5000;
        server = httpServer.listen(PORT, '0.0.0.0', () => {
            logger.info('=== STARTUP DIAGNOSTICS ===');
            logger.info(`Node Environment: ${config.nodeEnv}`);
            logger.info(`Port: ${PORT}`);
            logger.info(`MongoDB Connection Status: ${mongoose.connection.readyState === 1 ? 'Connected' : 'Connecting/Disconnected'}`);
            logger.info('Startup completion status: SUCCESS');
            logger.info('===========================');
            console.log(`🌐 [URL] http://localhost:${PORT}`);
        });

        const runExpire = async () => {
            try {
                await expireExpiredOffers();
            } catch (err) {
                logger.error(`Expire offers error: ${err.message}`);
            }
        };

        const runFssaiExpirySync = async () => {
            try {
                await syncExpiredFssaiNotifications();
            } catch (err) {
                logger.error(`FSSAI expiry sync error: ${err.message}`);
            }
        };

        const startIntervals = () => {
            runExpire();
            expireOffersInterval = setInterval(runExpire, 5 * 60 * 1000);

            runFssaiExpirySync();
            fssaiExpiryInterval = setInterval(runFssaiExpirySync, 60 * 60 * 1000);
        };

        if (mongoose.connection.readyState === 1) {
            startIntervals();
        } else {
            mongoose.connection.once('connected', () => {
                startIntervals();
            });
        }

        process.on('SIGINT', () => gracefulShutdown('SIGINT'));
        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

        // Handle server errors (like EADDRINUSE)
        server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                logger.error(`Port ${PORT} is already in use. Please kill the process or use a different port.`);
            } else {
                logger.error(`Server Error: ${err.message}`);
            }
            process.exit(1);
        });

        // Handle unhandled promise rejections.
        //
        // Deliberately does NOT exit. An unhandled rejection is almost always one request's
        // bug (a controller calling next() when it wasn't passed one, a stray .then, an
        // un-awaited call) rather than corrupted process state. Exiting turned any such bug
        // into a full outage: the process crash-looped under PM2, stopped listening, and
        // nginx served 502s to every user of every module. Log it loudly and keep serving.
        process.on('unhandledRejection', (err) => {
            logger.error(`Unhandled Rejection: ${err?.message || err}`);
            if (err?.stack) logger.error(err.stack);
        });

        // An uncaught exception CAN leave the process in an inconsistent state, so this one
        // still exits — but only after logging the stack, and PM2 restarts it.
        process.on('uncaughtException', (err) => {
            logger.error(`Uncaught Exception: ${err?.message || err}`);
            if (err?.stack) logger.error(err.stack);
            if (config.nodeEnv === 'production') {
                if (server) server.close(() => process.exit(1));
                else process.exit(1);
            }
        });

    } catch (error) {
        logger.error(`Error starting server: ${error.message}`);
        process.exit(1);
    }
};

startServer();

