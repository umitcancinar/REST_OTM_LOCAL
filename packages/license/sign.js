// Klasik Node modul cozumlemesi (moduleResolution: "Node") package.json
// "exports" alt yollarini desteklemiyor. Bu kok seviyesindeki koprü dosyasi
// sayesinde '@rest-otm/license/sign' hem eski hem yeni cozumlemede calisir.
//
// AYRIMIN SEBEBI: sign modulu OZEL anahtarla imza uretir ve yalnizca bulut
// tarafinda kullanilir. Ana giris noktasindan (index) bilerek disarida
// birakildi ki musteri paketine yanlislikla dahil edilmesin.
module.exports = require('./dist/sign.js');
