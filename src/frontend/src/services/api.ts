import axios, { AxiosInstance, AxiosError } from 'axios';
import keycloak from './keycloak';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const API_VERSION = import.meta.env.VITE_API_VERSION || 'v1';

class ApiService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: `${API_BASE_URL}/api/${API_VERSION}`,
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    // Request interceptor to add auth token
    this.client.interceptors.request.use(
      (config) => {
        if (keycloak.authenticated && keycloak.token) {
          config.headers.Authorization = `Bearer ${keycloak.token}`;
        }
        return config;
      },
      (error) => {
        return Promise.reject(error);
      }
    );

    // Response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        if (error.response?.status === 401) {
          // Token expired, try to refresh
          try {
            await keycloak.updateToken(30);
            // Retry the original request
            if (error.config) {
              error.config.headers.Authorization = `Bearer ${keycloak.token}`;
              return this.client.request(error.config);
            }
          } catch (refreshError) {
            // Refresh failed, redirect to login
            keycloak.login();
          }
        }
        return Promise.reject(error);
      }
    );
  }

  // Products
  async getProducts(category?: string) {
    const url = category ? `/products/category/${category}` : '/products';
    const response = await this.client.get(url);
    return response.data;
  }

  async getProduct(id: string) {
    const response = await this.client.get(`/products/${id}`);
    return response.data;
  }

  async getBestsellers() {
    const response = await this.client.get('/products/bestsellers');
    return response.data;
  }

  // Search
  async search(query: string) {
    const response = await this.client.get('/search', {
      params: { q: query },
    });
    return response.data;
  }

  async getSearchSuggestions(query: string) {
    const response = await this.client.get('/search/suggestions', {
      params: { q: query },
    });
    return response.data;
  }

  // Cart
  async getCart(userId: string) {
    const response = await this.client.get(`/cart/${userId}`);
    return response.data;
  }

  async addToCart(userId: string, productId: string, quantity: number) {
    const response = await this.client.post(`/cart/${userId}/items`, {
      productId,
      quantity,
    });
    return response.data;
  }

  async updateCartItem(userId: string, productId: string, quantity: number) {
    const response = await this.client.put(`/cart/${userId}/items/${productId}`, {
      quantity,
    });
    return response.data;
  }

  async removeFromCart(userId: string, productId: string) {
    const response = await this.client.delete(`/cart/${userId}/items/${productId}`);
    return response.data;
  }

  async clearCart(userId: string) {
    const response = await this.client.delete(`/cart/${userId}`);
    return response.data;
  }

  // Orders
  async createOrder(userId: string) {
    const response = await this.client.post('/orders', { userId });
    return response.data;
  }

  async getOrders(userId: string) {
    const response = await this.client.get(`/orders/${userId}`);
    return response.data;
  }

  async getOrder(userId: string, orderId: string) {
    const response = await this.client.get(`/orders/${userId}/${orderId}`);
    return response.data;
  }

  // Recommendations
  async getRecommendations(userId: string) {
    const response = await this.client.get(`/recommendations/${userId}`);
    return response.data;
  }

  async getSimilarBooks(bookId: string) {
    const response = await this.client.get(`/recommendations/books/${bookId}/similar`);
    return response.data;
  }

  async getTrendingBooks() {
    const response = await this.client.get('/recommendations/trending');
    return response.data;
  }
}

export default new ApiService();
