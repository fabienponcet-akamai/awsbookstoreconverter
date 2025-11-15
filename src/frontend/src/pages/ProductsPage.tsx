import React, { useEffect, useState } from 'react';
import { Container, Row, Col, Form, Button } from 'react-bootstrap';
import { useDispatch, useSelector } from 'react-redux';
import { useSearchParams } from 'react-router-dom';
import { AppDispatch, RootState } from '../store';
import { fetchProducts } from '../store/slices/productsSlice';
import { addToCart } from '../store/slices/cartSlice';
import ProductCard from '../components/ProductCard';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';
import { useAuth } from '../hooks/useAuth';
import { toast } from 'react-toastify';
import { Product } from '../types';

const CATEGORIES = [
  'All',
  'Fiction',
  'Non-Fiction',
  'Science Fiction',
  'Mystery',
  'Romance',
  'Biography',
  'History',
  'Self-Help',
  'Technology',
  'Business',
];

const ProductsPage: React.FC = () => {
  const dispatch = useDispatch<AppDispatch>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { items, loading, error } = useSelector((state: RootState) => state.products);
  const { isAuthenticated, user } = useAuth();

  const categoryParam = searchParams.get('category') || 'All';
  const [selectedCategory, setSelectedCategory] = useState(categoryParam);

  useEffect(() => {
    const category = selectedCategory === 'All' ? undefined : selectedCategory;
    dispatch(fetchProducts(category));
  }, [dispatch, selectedCategory]);

  const handleCategoryChange = (category: string) => {
    setSelectedCategory(category);
    if (category === 'All') {
      setSearchParams({});
    } else {
      setSearchParams({ category });
    }
  };

  const handleAddToCart = (product: Product) => {
    if (!isAuthenticated || !user?.sub) {
      toast.error('Please login to add items to cart');
      return;
    }

    dispatch(addToCart({
      userId: user.sub,
      productId: product.id,
      quantity: 1,
    }))
      .unwrap()
      .then(() => {
        toast.success(`${product.title} added to cart!`);
      })
      .catch(() => {
        toast.error('Failed to add item to cart');
      });
  };

  return (
    <Container className="py-4">
      <h1 className="mb-4">Browse Books</h1>

      <Row>
        {/* Sidebar Filters */}
        <Col md={3} className="mb-4">
          <div className="bg-light p-3 rounded">
            <h5 className="mb-3">Categories</h5>
            <Form>
              {CATEGORIES.map((category) => (
                <Form.Check
                  key={category}
                  type="radio"
                  id={`category-${category}`}
                  label={category}
                  checked={selectedCategory === category}
                  onChange={() => handleCategoryChange(category)}
                  className="mb-2"
                />
              ))}
            </Form>
          </div>
        </Col>

        {/* Products Grid */}
        <Col md={9}>
          {loading && <LoadingSpinner message="Loading products..." />}

          {error && (
            <ErrorMessage
              message={error}
              onRetry={() => dispatch(fetchProducts(selectedCategory === 'All' ? undefined : selectedCategory))}
            />
          )}

          {!loading && !error && items.length === 0 && (
            <div className="empty-state">
              <h3>No products found</h3>
              <p>Try selecting a different category</p>
            </div>
          )}

          {!loading && !error && items.length > 0 && (
            <>
              <div className="mb-3 text-muted">
                Showing {items.length} {items.length === 1 ? 'book' : 'books'}
                {selectedCategory !== 'All' && ` in ${selectedCategory}`}
              </div>
              <Row>
                {items.map((product) => (
                  <Col key={product.id} sm={6} lg={4} className="mb-4">
                    <ProductCard product={product} onAddToCart={handleAddToCart} />
                  </Col>
                ))}
              </Row>
            </>
          )}
        </Col>
      </Row>
    </Container>
  );
};

export default ProductsPage;
