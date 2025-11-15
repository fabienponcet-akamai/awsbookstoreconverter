import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import api from '../../services/api';
import { Product } from '../../types';

interface ProductsState {
  items: Product[];
  bestsellers: Product[];
  currentProduct: Product | null;
  loading: boolean;
  error: string | null;
}

const initialState: ProductsState = {
  items: [],
  bestsellers: [],
  currentProduct: null,
  loading: false,
  error: null,
};

export const fetchProducts = createAsyncThunk(
  'products/fetchProducts',
  async (category?: string) => {
    const data = await api.getProducts(category);
    return data;
  }
);

export const fetchProduct = createAsyncThunk(
  'products/fetchProduct',
  async (id: string) => {
    const data = await api.getProduct(id);
    return data;
  }
);

export const fetchBestsellers = createAsyncThunk(
  'products/fetchBestsellers',
  async () => {
    const data = await api.getBestsellers();
    return data;
  }
);

const productsSlice = createSlice({
  name: 'products',
  initialState,
  reducers: {
    clearCurrentProduct: (state) => {
      state.currentProduct = null;
    },
    clearError: (state) => {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      // Fetch products
      .addCase(fetchProducts.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchProducts.fulfilled, (state, action: PayloadAction<Product[]>) => {
        state.loading = false;
        state.items = action.payload;
      })
      .addCase(fetchProducts.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch products';
      })
      // Fetch product
      .addCase(fetchProduct.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchProduct.fulfilled, (state, action: PayloadAction<Product>) => {
        state.loading = false;
        state.currentProduct = action.payload;
      })
      .addCase(fetchProduct.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch product';
      })
      // Fetch bestsellers
      .addCase(fetchBestsellers.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchBestsellers.fulfilled, (state, action: PayloadAction<Product[]>) => {
        state.loading = false;
        state.bestsellers = action.payload;
      })
      .addCase(fetchBestsellers.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch bestsellers';
      });
  },
});

export const { clearCurrentProduct, clearError } = productsSlice.actions;
export default productsSlice.reducer;
