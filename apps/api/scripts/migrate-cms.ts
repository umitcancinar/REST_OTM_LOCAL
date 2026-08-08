import { PrismaClient } from '@prisma/client';
import * as admin from 'firebase-admin';

// Initialize Firebase Admin (from existing config)
const serviceAccount = require('../src/config/firebase-service-account.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL || 'https://restaurantyonetimi-default-rtdb.firebaseio.com',
  });
}

const firebaseDb = admin.database();
const prisma = new PrismaClient();

async function migrateCMS() {
  console.log('Starting CMS migration from Firebase...');
  
  const tenantSlug = 'lezzet-restoran';
  
  // Find tenant ID
  const tenant = await prisma.tenant.findFirst({
    where: { slug: tenantSlug }
  });

  if (!tenant) {
    console.error(`Tenant with slug ${tenantSlug} not found in SQL database.`);
    process.exit(1);
  }

  const tenantId = tenant.id;

  try {
    // 1. Settings
    console.log('Fetching CMS Settings...');
    const settingsSnap = await firebaseDb.ref('cms/settings').once('value');
    const settings = settingsSnap.val() || {};
    
    // Update tenant settings in JSONB
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { settings }
    });
    console.log('Settings migrated successfully.');

    // 2. Gallery
    console.log('Fetching CMS Gallery...');
    const gallerySnap = await firebaseDb.ref('cms/gallery').once('value');
    const galleryItems = gallerySnap.val() || [];
    
    // Delete existing gallery images to prevent duplicates
    await prisma.galleryImage.deleteMany({ where: { tenantId } });
    
    let sortOrder = 0;
    for (const item of galleryItems) {
      if (item && item.url) {
        await prisma.galleryImage.create({
          data: {
            tenantId,
            url: item.url,
            alt: item.alt || '',
            sortOrder: sortOrder++
          }
        });
      }
    }
    console.log('Gallery migrated successfully.');

    // 3. Stories
    console.log('Fetching CMS Stories...');
    const storiesSnap = await firebaseDb.ref('cms/stories').once('value');
    const storiesObj = storiesSnap.val() || {};
    const storiesArray = Array.isArray(storiesObj) ? storiesObj : Object.values(storiesObj);
    
    await prisma.story.deleteMany({ where: { tenantId } });
    
    sortOrder = 0;
    for (const story of storiesArray as any[]) {
      if (story && story.title) {
        await prisma.story.create({
          data: {
            tenantId,
            title: story.title || '',
            mediaUrl: story.mediaUrl || '',
            mediaType: story.mediaType || 'image',
            sortOrder: sortOrder++
          }
        });
      }
    }
    console.log('Stories migrated successfully.');

    // 4. Testimonials (optional, if we have a table for it)
    console.log('Fetching CMS Reviews (Testimonials)...');
    const reviewsSnap = await firebaseDb.ref('cms/reviews').once('value');
    const reviewsObj = reviewsSnap.val() || {};
    const reviews = Array.isArray(reviewsObj) ? reviewsObj : Object.values(reviewsObj);
    
    // Check if review/testimonial table exists, otherwise store in settings
    settings.reviews = reviews;
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { settings }
    });
    console.log('Reviews saved to tenant settings.');

    console.log('✅ CMS Migration Completed Successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await prisma.$disconnect();
    process.exit(0);
  }
}

migrateCMS();
