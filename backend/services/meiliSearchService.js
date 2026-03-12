const { MeiliSearch } = require('meilisearch');
const dotenv = require('dotenv');

dotenv.config();

class MeiliSearchService {
  constructor() {
    this.client = new MeiliSearch({
      host: process.env.MEILISEARCH_HOST || 'http://127.0.0.1:7700',
      apiKey: process.env.MEILISEARCH_API_KEY || 'masterKey',
    });
    this.indexName = 'products';
    this.isConnected = false;
    this.init();
  }

  async init() {
    try {
      // Check connection
      const health = await this.client.health();
      if (health.status === 'available') {
        this.isConnected = true;
        console.log('Meilisearch Connected');
        await this.ensureIndex();
      } else {
        console.warn('Meilisearch is not available');
      }
    } catch (error) {
      console.error('Meilisearch connection error:', error.message);
      this.isConnected = false;
    }
  }

  async ensureIndex() {
    if (!this.isConnected) return;

    try {
      const index = this.client.index(this.indexName);
      
      // Update settings
      await index.updateSettings({
        searchableAttributes: [
          'name',
          'description',
          'category.name',
          'shop.name',
          'tags',
          'brand'
        ],
        filterableAttributes: [
          'categoryId',
          'shopId',
          'price',
          'rating.average',
          'status',
          'isActive'
        ],
        sortableAttributes: [
          'price',
          'createdAt',
          'rating.average',
          'salesCount'
        ],
        rankingRules: [
          'words',
          'typo',
          'proximity',
          'attribute',
          'sort',
          'exactness'
        ]
      });
      
      console.log('Meilisearch index settings updated');
    } catch (error) {
      console.error('Error ensuring index:', error);
    }
  }

  async indexProduct(product) {
    if (!this.isConnected || !product) return;

    try {
      const index = this.client.index(this.indexName);
      
      // Transform product for indexing
      const document = {
        id: product._id.toString(),
        name: product.name,
        description: product.description,
        price: product.price,
        discountPrice: product.discountPrice,
        categoryId: product.categoryId?._id?.toString() || product.categoryId?.toString(),
        category: product.categoryId?.name ? { name: product.categoryId.name } : undefined,
        shopId: product.shopId?._id?.toString() || product.shopId?.toString(),
        shop: product.shopId?.name ? { name: product.shopId.name } : undefined,
        images: product.images,
        rating: product.rating,
        status: product.status,
        isActive: product.isActive,
        tags: product.tags,
        brand: product.brand,
        salesCount: product.salesCount,
        createdAt: product.createdAt ? new Date(product.createdAt).getTime() : Date.now()
      };

      await index.addDocuments([document]);
      // console.log(`Indexed product: ${product.name}`);
    } catch (error) {
      console.error('Error indexing product:', error);
    }
  }

  async deleteProduct(productId) {
    if (!this.isConnected || !productId) return;

    try {
      const index = this.client.index(this.indexName);
      await index.deleteDocument(productId.toString());
      console.log(`Deleted product from index: ${productId}`);
    } catch (error) {
      console.error('Error deleting product from index:', error);
    }
  }

  async search(query, filters = {}) {
    if (!this.isConnected) {
      console.warn('Meilisearch not connected, returning empty results');
      return { hits: [], nbHits: 0 };
    }

    try {
      const index = this.client.index(this.indexName);
      
      const searchParams = {
        limit: filters.limit || 20,
        offset: (filters.page ? (filters.page - 1) * (filters.limit || 20) : 0),
        filter: [],
        sort: []
      };

      // Build filters
      if (filters.categoryId) {
        searchParams.filter.push(`categoryId = "${filters.categoryId}"`);
      }
      if (filters.shopId) {
        searchParams.filter.push(`shopId = "${filters.shopId}"`);
      }
      if (filters.minPrice !== undefined) {
        searchParams.filter.push(`price >= ${filters.minPrice}`);
      }
      if (filters.maxPrice !== undefined) {
        searchParams.filter.push(`price <= ${filters.maxPrice}`);
      }
      if (filters.minRating !== undefined) {
        searchParams.filter.push(`rating.average >= ${filters.minRating}`);
      }
      if (filters.status) {
        searchParams.filter.push(`status = "${filters.status}"`);
      }
      // Always filter for active products unless specified otherwise
      if (filters.isActive !== undefined) {
        searchParams.filter.push(`isActive = ${filters.isActive}`);
      } else {
        searchParams.filter.push(`isActive = true`);
      }

      // Build sort
      if (filters.sortBy) {
        const sortOrder = filters.sortOrder === 'asc' ? 'asc' : 'desc';
        searchParams.sort.push(`${filters.sortBy}:${sortOrder}`);
      }

      const result = await index.search(query, searchParams);
      
      return {
        hits: result.hits,
        total: result.estimatedTotalHits,
        page: filters.page || 1,
        totalPages: Math.ceil(result.estimatedTotalHits / (filters.limit || 20))
      };

    } catch (error) {
      console.error('Meilisearch search error:', error);
      throw error;
    }
  }

  async reindexAll() {
    if (!this.isConnected) {
      throw new Error('Meilisearch is not connected');
    }

    try {
      const Product = require('../models/Product');
      
      console.log('Starting full reindex...');
      
      // Delete existing index
      try {
        await this.client.deleteIndex(this.indexName);
      } catch (e) {
        // Ignore if index doesn't exist
      }

      // Recreate index and settings
      await this.ensureIndex();

      const index = this.client.index(this.indexName);
      
      // Fetch all products
      const products = await Product.find({})
        .populate('shopId', 'name')
        .populate('categoryId', 'name');
        
      console.log(`Found ${products.length} products to index`);

      const documents = products.map(product => ({
        id: product._id.toString(),
        name: product.name,
        description: product.description,
        price: product.price,
        discountPrice: product.discountPrice,
        categoryId: product.categoryId?._id?.toString() || product.categoryId?.toString(),
        category: product.categoryId?.name ? { name: product.categoryId.name } : undefined,
        shopId: product.shopId?._id?.toString() || product.shopId?.toString(),
        shop: product.shopId?.name ? { name: product.shopId.name } : undefined,
        images: product.images,
        rating: product.rating,
        status: product.status,
        isActive: product.isActive,
        tags: product.tags,
        brand: product.brand,
        salesCount: product.salesCount,
        createdAt: product.createdAt ? new Date(product.createdAt).getTime() : Date.now()
      }));

      // Add in batches
      const batchSize = 1000;
      for (let i = 0; i < documents.length; i += batchSize) {
        const batch = documents.slice(i, i + batchSize);
        await index.addDocuments(batch);
        console.log(`Indexed batch ${i / batchSize + 1}`);
      }

      console.log('Reindexing completed successfully');
      return { count: products.length };

    } catch (error) {
      console.error('Reindexing failed:', error);
      throw error;
    }
  }
}

module.exports = new MeiliSearchService();
