const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({ datasources: { db: { url: "postgres://rest_otm_user:yTebl0qM0W5sZ9qjXj8Q60E2qA745qHw@dpg-cuiduop2ng1s738sh8mg-a.frankfurt-postgres.render.com/rest_otm_db" } } });
async function test() {
  const id = 'cmo5xremv0000vynl0p1rn2f5';
  const data = { settings: { printLayouts: { GRILL: { headerText: 'LOCAL_TEST' } } } };
  
  const existing = await prisma.tenant.findUnique({ where: { id }, select: { settings: true } });
  console.log("Existing settings:", existing.settings);
  
  let currentSettings = {};
  if (typeof existing?.settings === 'string') {
    try { currentSettings = JSON.parse(existing.settings); } catch (e) {}
  } else if (existing?.settings && typeof existing.settings === 'object') {
    currentSettings = existing.settings;
  }
  
  const finalSettings = { ...currentSettings, ...data.settings };
  console.log("Final settings to save:", finalSettings);
  
  const result = await prisma.tenant.update({
    where: { id },
    data: { settings: finalSettings }
  });
  
  console.log("Result settings:", result.settings);
}
test().catch(console.error).finally(() => prisma.$disconnect());
