export interface Product {
  id: string;
  title: string;
  author: string;
  category: string;
  price: number;
  description?: string;
  coverImage?: string;
  isbn?: string;
  publishedDate?: string;
  rating?: number;
  stock?: number;
}

export interface CartItem {
  productId: string;
  product: Product;
  quantity: number;
  price: number;
}

export interface Cart {
  userId: string;
  items: CartItem[];
  total: number;
  itemCount: number;
}

export interface Order {
  id: string;
  userId: string;
  items: OrderItem[];
  total: number;
  status: OrderStatus;
  createdAt: string;
  updatedAt?: string;
}

export interface OrderItem {
  productId: string;
  title: string;
  author: string;
  quantity: number;
  price: number;
}

export enum OrderStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export interface User {
  id: string;
  email: string;
  name?: string;
  username?: string;
}

export interface SearchResult {
  products: Product[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Recommendation {
  product: Product;
  score: number;
  reason?: string;
}

export interface ApiError {
  message: string;
  code?: string;
  details?: unknown;
}
