import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import api from '../../services/api';
import { Cart } from '../../types';

interface CartState {
  cart: Cart | null;
  loading: boolean;
  error: string | null;
}

const initialState: CartState = {
  cart: null,
  loading: false,
  error: null,
};

export const fetchCart = createAsyncThunk(
  'cart/fetchCart',
  async (userId: string) => {
    const data = await api.getCart(userId);
    return data;
  }
);

export const addToCart = createAsyncThunk(
  'cart/addToCart',
  async ({ userId, productId, quantity }: { userId: string; productId: string; quantity: number }) => {
    const data = await api.addToCart(userId, productId, quantity);
    return data;
  }
);

export const updateCartItem = createAsyncThunk(
  'cart/updateCartItem',
  async ({ userId, productId, quantity }: { userId: string; productId: string; quantity: number }) => {
    const data = await api.updateCartItem(userId, productId, quantity);
    return data;
  }
);

export const removeFromCart = createAsyncThunk(
  'cart/removeFromCart',
  async ({ userId, productId }: { userId: string; productId: string }) => {
    const data = await api.removeFromCart(userId, productId);
    return data;
  }
);

export const clearCart = createAsyncThunk(
  'cart/clearCart',
  async (userId: string) => {
    const data = await api.clearCart(userId);
    return data;
  }
);

const cartSlice = createSlice({
  name: 'cart',
  initialState,
  reducers: {
    resetCart: (state) => {
      state.cart = null;
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      // Fetch cart
      .addCase(fetchCart.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchCart.fulfilled, (state, action: PayloadAction<Cart>) => {
        state.loading = false;
        state.cart = action.payload;
      })
      .addCase(fetchCart.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch cart';
      })
      // Add to cart
      .addCase(addToCart.fulfilled, (state, action: PayloadAction<Cart>) => {
        state.cart = action.payload;
      })
      // Update cart item
      .addCase(updateCartItem.fulfilled, (state, action: PayloadAction<Cart>) => {
        state.cart = action.payload;
      })
      // Remove from cart
      .addCase(removeFromCart.fulfilled, (state, action: PayloadAction<Cart>) => {
        state.cart = action.payload;
      })
      // Clear cart
      .addCase(clearCart.fulfilled, (state) => {
        state.cart = null;
      });
  },
});

export const { resetCart } = cartSlice.actions;
export default cartSlice.reducer;
