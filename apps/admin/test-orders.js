(async () => {
  const { default: puppeteer } = await import('puppeteer');
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', error => console.log('PAGE ERROR:', error.message));

  try {
    await page.goto('http://localhost:3000/orders', { waitUntil: 'networkidle0' });
    console.log("Page loaded.");
    
    // Check if there's any order card to click
    const cards = await page.$$('.card');
    console.log(`Found ${cards.length} cards.`);
    if (cards.length > 0) {
      console.log("Clicking the first order card...");
      await cards[0].click();
      await new Promise((resolve) => setTimeout(resolve, 2000));
      
      const modal = await page.$('.modal-overlay');
      if (modal) {
        console.log("SUCCESS: Modal opened without crashing!");
      } else {
        console.log("WARNING: Modal overlay not found.");
      }
    }
  } catch (e) {
    console.log("TEST FAILED", e);
  } finally {
    await browser.close();
  }
})();
