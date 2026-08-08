"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.publicController = void 0;
const database_1 = require("../../config/database");
const apiResponse_1 = require("../../utils/apiResponse");
/**
 * Helper to resolve tenant by slug and return its ID.
 */
async function getTenantIdBySlug(slug) {
    const tenant = await database_1.prisma.tenant.findUnique({
        where: { slug, isActive: true },
        select: { id: true }
    });
    return tenant?.id;
}
exports.publicController = {
    /**
     * TEHLIKELI ISLEM: Bir isletmenin masa numaralarini standart semaya
     * (MS1-24 Salon, MT25-40 Teras, VIP 1-20) gore yeniden duzenler; fazla
     * masalari siler/yeniden adlandirir. Once TUM kiracilar uzerinde,
     * kimlik dogrulamasi olmadan, GET ile calisiyordu — bu, internete acik
     * herkesin tek istekle butun restoranlarin masa verisini bozabilmesi
     * anlamina geliyordu. Artik SUPER_ADMIN yetkisi ve acikca belirtilmis
     * TEK bir tenantId zorunlu.
     */
    async fixTables(req, res, next) {
        try {
            const targetTenantId = req.body?.tenantId || req.query.tenantId;
            if (!targetTenantId || typeof targetTenantId !== 'string') {
                (0, apiResponse_1.apiError)(res, 400, 'tenantId zorunludur. Bu islem artik tum kiracilar uzerinde otomatik calismaz.');
                return;
            }
            const tenants = await database_1.prisma.tenant.findMany({ where: { id: targetTenantId } });
            if (tenants.length === 0) {
                (0, apiResponse_1.apiError)(res, 404, 'Tenant bulunamadi.');
                return;
            }
            let totalUpdated = 0;
            let totalDeleted = 0;
            let totalCreated = 0;
            for (const tenant of tenants) {
                const tables = await database_1.prisma.restaurantTable.findMany({ where: { tenantId: tenant.id } });
                const targetNames = [];
                for (let i = 1; i <= 24; i++)
                    targetNames.push({ name: `MS${i}`, zone: 'Salon' });
                for (let i = 25; i <= 40; i++)
                    targetNames.push({ name: `MT${i}`, zone: 'Teras' });
                for (let i = 1; i <= 20; i++)
                    targetNames.push({ name: `VIP ${i}`, zone: 'VIP' });
                const existingTargets = tables.filter(t => targetNames.some(target => target.name === t.number));
                const extraTables = tables.filter(t => !existingTargets.includes(t));
                // Which targets are missing?
                const missingTargets = targetNames.filter(target => !existingTargets.some(t => t.number === target.name));
                // Use extra tables to fulfill missing targets
                for (let i = 0; i < missingTargets.length; i++) {
                    const target = missingTargets[i];
                    if (extraTables.length > 0) {
                        const tableToRename = extraTables.pop();
                        await database_1.prisma.restaurantTable.update({
                            where: { id: tableToRename.id },
                            data: { number: target.name, zone: target.zone }
                        });
                        totalUpdated++;
                    }
                    else {
                        await database_1.prisma.restaurantTable.create({
                            data: {
                                tenantId: tenant.id,
                                number: target.name,
                                zone: target.zone,
                                capacity: 4
                            }
                        });
                        totalCreated++;
                    }
                }
                // Delete any remaining extra tables
                for (const table of extraTables) {
                    try {
                        await database_1.prisma.restaurantTable.delete({ where: { id: table.id } });
                        totalDeleted++;
                    }
                    catch (e) {
                        // Cannot delete (probably has orders), rename it so it's out of the way
                        await database_1.prisma.restaurantTable.update({
                            where: { id: table.id },
                            data: { number: `Silinecek_${table.number}_${Math.floor(Math.random() * 1000)}`, zone: 'Pasif' }
                        });
                        totalUpdated++;
                    }
                }
            }
            (0, apiResponse_1.apiResponse)({ res, statusCode: 200, message: 'Tables synchronized successfully', data: { totalUpdated, totalDeleted, totalCreated } });
        }
        catch (err) {
            next(err);
        }
    },
    /**
     * Resolves a tenant by slug or custom domain and returns public settings.
     */
    async getTenantInfo(req, res, next) {
        try {
            const identifier = req.query.domain || req.query.slug;
            if (!identifier) {
                (0, apiResponse_1.apiError)(res, 400, 'domain or slug is required');
                return;
            }
            const tenant = await database_1.prisma.tenant.findFirst({
                where: {
                    OR: [
                        { slug: String(identifier) },
                        { customDomain: String(identifier) }
                    ],
                    isActive: true
                },
                select: {
                    id: true,
                    name: true,
                    slug: true,
                    customDomain: true,
                    logo: true,
                    settings: true,
                    address: true,
                    phone: true,
                    email: true
                }
            });
            if (!tenant) {
                (0, apiResponse_1.apiError)(res, 404, 'Restaurant not found');
                return;
            }
            (0, apiResponse_1.apiResponse)({ res, data: tenant });
        }
        catch (error) {
            next(error);
        }
    },
    /**
     * Gets the public menu for a tenant by SLUG (RESTful pattern).
     */
    async getMenuBySlug(req, res, next) {
        try {
            const { slug } = req.params;
            const tenant = await database_1.prisma.tenant.findUnique({
                where: { slug: String(slug), isActive: true },
                select: { id: true, name: true }
            });
            if (!tenant) {
                (0, apiResponse_1.apiError)(res, 404, 'Restaurant not found');
                return;
            }
            const categories = await database_1.prisma.menuCategory.findMany({
                where: { tenantId: tenant.id, isActive: true },
                orderBy: { sortOrder: 'asc' },
                include: {
                    items: {
                        where: { isActive: true },
                        orderBy: { sortOrder: 'asc' },
                        select: {
                            id: true,
                            name: true,
                            description: true,
                            image: true,
                            basePrice: true,
                            taxRate: true,
                            portionOptions: true,
                            extras: true,
                            department: true,
                            preparationTime: true,
                            allergens: true,
                            calories: true,
                            extraInfo: true,
                            badge: true,
                            sortOrder: true,
                            isActive: true,
                        }
                    }
                }
            });
            (0, apiResponse_1.apiResponse)({
                res,
                data: {
                    restaurantName: tenant.name,
                    categories
                }
            });
        }
        catch (error) {
            next(error);
        }
    },
    /**
     * Gets public CMS settings by slug.
     */
    async getCmsSettings(req, res, next) {
        try {
            const { slug } = req.params;
            const tenant = await database_1.prisma.tenant.findUnique({
                where: { slug: String(slug), isActive: true },
                select: { settings: true }
            });
            if (!tenant)
                return (0, apiResponse_1.apiError)(res, 404, 'Restaurant not found');
            // Parse settings if it's a string (though Prisma should handle it if it's Json type)
            const settings = typeof tenant.settings === 'string' ? JSON.parse(tenant.settings) : tenant.settings;
            (0, apiResponse_1.apiResponse)({ res, data: settings });
        }
        catch (error) {
            next(error);
        }
    },
    /**
     * Gets public gallery images by slug.
     */
    async getGallery(req, res, next) {
        try {
            const { slug } = req.params;
            const tenantId = await getTenantIdBySlug(String(slug));
            if (!tenantId)
                return (0, apiResponse_1.apiError)(res, 404, 'Restaurant not found');
            const images = await database_1.prisma.galleryImage.findMany({
                where: { tenantId, isActive: true },
                orderBy: { sortOrder: 'asc' }
            });
            (0, apiResponse_1.apiResponse)({ res, data: images });
        }
        catch (error) {
            next(error);
        }
    },
    /**
     * Gets public stories by slug.
     */
    async getStories(req, res, next) {
        try {
            const { slug } = req.params;
            const tenantId = await getTenantIdBySlug(String(slug));
            if (!tenantId)
                return (0, apiResponse_1.apiError)(res, 404, 'Restaurant not found');
            const stories = await database_1.prisma.story.findMany({
                where: {
                    tenantId,
                    isActive: true,
                    OR: [
                        { expiresAt: null },
                        { expiresAt: { gt: new Date() } }
                    ]
                },
                orderBy: { sortOrder: 'asc' }
            });
            (0, apiResponse_1.apiResponse)({ res, data: stories });
        }
        catch (error) {
            next(error);
        }
    },
    /**
     * Gets public reviews by slug.
     */
    async getReviews(req, res, next) {
        try {
            const { slug } = req.params;
            const tenantId = await getTenantIdBySlug(String(slug));
            if (!tenantId)
                return (0, apiResponse_1.apiError)(res, 404, 'Restaurant not found');
            const reviews = await database_1.prisma.review.findMany({
                where: { tenantId, isApproved: true },
                orderBy: { createdAt: 'desc' }
            });
            (0, apiResponse_1.apiResponse)({ res, data: reviews });
        }
        catch (error) {
            next(error);
        }
    },
    /**
     * Gets public active reservations by slug (to show occupied slots on map).
     */
    async getReservations(req, res, next) {
        try {
            const { slug } = req.params;
            const tenantId = await getTenantIdBySlug(String(slug));
            if (!tenantId)
                return (0, apiResponse_1.apiError)(res, 404, 'Restaurant not found');
            const reservations = await database_1.prisma.reservation.findMany({
                where: {
                    tenantId,
                    status: { in: ['CONFIRMED', 'PENDING'] }, // Only show active/pending ones
                    reservationTime: { gte: new Date() } // Future or today
                },
                select: {
                    id: true,
                    tableId: true,
                    reservationTime: true,
                    guestCount: true,
                    status: true
                }
            });
            (0, apiResponse_1.apiResponse)({ res, data: reservations });
        }
        catch (error) {
            next(error);
        }
    },
    /**
     * Gets public table map by slug.
     */
    async getTableMap(req, res, next) {
        try {
            const { slug } = req.params;
            const tenantId = await getTenantIdBySlug(String(slug));
            if (!tenantId)
                return (0, apiResponse_1.apiError)(res, 404, 'Restaurant not found');
            const tables = await database_1.prisma.restaurantTable.findMany({
                where: { tenantId },
                orderBy: { number: 'asc' }
            });
            (0, apiResponse_1.apiResponse)({ res, data: tables });
        }
        catch (error) {
            next(error);
        }
    },
    /**
     * Gets public navigation links by slug.
     */
    async getNavLinks(req, res, next) {
        try {
            // For now, these might be static or stored in settings.
            // We can return a default set or fetch from tenant settings.
            const { slug } = req.params;
            const tenant = await database_1.prisma.tenant.findUnique({
                where: { slug: String(slug), isActive: true },
                select: { settings: true }
            });
            if (!tenant)
                return (0, apiResponse_1.apiError)(res, 404, 'Restaurant not found');
            const settings = typeof tenant.settings === 'string' ? JSON.parse(tenant.settings) : tenant.settings;
            (0, apiResponse_1.apiResponse)({ res, data: settings?.navLinks || [] });
        }
        catch (error) {
            next(error);
        }
    },
    /**
     * Musteri menu uygulamasindan garson cagirma. Kimlik dogrulamasi yok
     * (musteri hesabi olmaz) ama masanin GERCEKTEN o restorana ait oldugu
     * dogrulanir; boylece rastgele bir tableId ile baska tenant'in odasina
     * sinyal gonderilemez.
     */
    async callWaiter(req, res, next) {
        try {
            const { slug } = req.params;
            const { tableId } = req.body;
            if (!tableId) {
                (0, apiResponse_1.apiError)(res, 400, 'Masa numarası gereklidir.');
                return;
            }
            const tenantId = await getTenantIdBySlug(String(slug));
            if (!tenantId)
                return (0, apiResponse_1.apiError)(res, 404, 'Restoran bulunamadı.');
            const table = await database_1.prisma.restaurantTable.findFirst({
                where: { id: tableId, tenantId },
                select: { id: true },
            });
            if (!table)
                return (0, apiResponse_1.apiError)(res, 404, 'Masa bulunamadı.');
            const { getIO } = await Promise.resolve().then(() => __importStar(require('../../websocket/socket.server')));
            getIO().to(`tenant:${tenantId}`).emit('waiter:called', {
                tableId,
                time: new Date().toISOString(),
            });
            (0, apiResponse_1.apiResponse)({ res, message: 'Garson çağrıldı' });
        }
        catch (error) {
            next(error);
        }
    },
    /**
     * Legacy method (kept for compatibility)
     */
    async getMenu(req, res, next) {
        try {
            const tenantId = req.query.tenantId;
            if (!tenantId) {
                (0, apiResponse_1.apiError)(res, 400, 'tenantId is required');
                return;
            }
            const categories = await database_1.prisma.menuCategory.findMany({
                where: { tenantId, isActive: true },
                orderBy: { sortOrder: 'asc' },
                include: {
                    items: {
                        where: { isActive: true },
                        orderBy: { sortOrder: 'asc' }
                    }
                }
            });
            (0, apiResponse_1.apiResponse)({ res, data: categories });
        }
        catch (error) {
            next(error);
        }
    }
};
//# sourceMappingURL=public.controller.js.map