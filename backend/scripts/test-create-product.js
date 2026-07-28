require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

(async () => {
  const Database = require('../models/DatabaseAdapter');
  const { connectPostgres } = require('../models/postgres');
  const productController = require('../controllers/productController');
  // Access normalize via re-require internal - call create path manually
  const { v4: uuidv4 } = require('uuid');
  const {
    normalizeVariants,
    variantsToLegacyColors,
  } = require('../utils/productVariants');
  const { toStoredMediaPath } = require('../utils/localUpload');
  const { validateProductData } = require('../utils/validators');

  await connectPostgres();
  Database.dbType = 'postgres';

  // Simulate frontend buildProductPayload
  const body = {
    name: 'Scrub Multi Color',
    category: 'scrubs',
    price: 1200,
    image: '',
    images: [],
    description: { tagline: 'Nice scrub', details: 'Nice scrub' },
    subDescription: '',
    productInformation: '',
    sizes: ['S', 'M', 'L'],
    colors: [{ name: 'Navy', code: '#0B1E5B' }],
    variants: [
      {
        id: 'tmp-1',
        colorName: 'Navy',
        colorHex: '#0B1E5B',
        images: ['/uploads/products/products-1785087815879-08104c4de2e27ab221b49713.png'],
        stock: 25,
        sku: 'SCRUB-NAVY',
        price: null,
        active: true,
        sizeStock: null,
      },
      {
        id: 'tmp-2',
        colorName: 'Black',
        colorHex: '#000000',
        images: ['/uploads/products/products-1785087815879-08104c4de2e27ab221b49713.png'],
        stock: 0,
        sku: 'SCRUB-BLACK',
        price: 1350,
        active: true,
      },
    ],
    sizeChart: null,
  };

  // Replicate normalizeProductPayload (imported logic by requiring controller file is hard)
  // Just create with what controller would produce
  const finalImages = body.images.length
    ? body.images
    : body.variants[0].images;
  const variants = normalizeVariants(body, null, finalImages);
  const payload = {
    name: body.name,
    slug: 'scrub-multi-color-' + uuidv4().slice(0, 4),
    price: Number(body.price),
    originalPrice: null,
    description: body.description,
    subDescription: '',
    productInformation: '',
    category: body.category,
    image: finalImages[0],
    images: finalImages,
    sizes: body.sizes,
    colors: variantsToLegacyColors(variants),
    variants,
    sizeChart: null,
    quickDry: false,
    isActive: true,
  };

  console.log('validation', validateProductData(payload));
  console.log('payload keys', Object.keys(payload));

  const id = uuidv4();
  try {
    const created = await Database.create('products', {
      ...payload,
      id,
      _id: id,
      createdBy: 'admin-test',
      createdAt: new Date().toISOString(),
    });
    console.log('SUCCESS', created.id, 'variants count', (created.variants || []).length);
    await Database.delete('products', id);
  } catch (e) {
    console.error('FAIL', e.message);
  }
  process.exit(0);
})();
