import React, { useEffect } from 'react';
import { Container, Row, Col, Button, Card } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { AppDispatch, RootState } from '../store';
import { fetchBestsellers } from '../store/slices/productsSlice';
import ProductCard from '../components/ProductCard';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';
import { useAuth } from '../hooks/useAuth';
import { addToCart } from '../store/slices/cartSlice';
import { toast } from 'react-toastify';
import { Product } from '../types';

const HomePage: React.FC = () => {
  const dispatch = useDispatch<AppDispatch>();
  const { bestsellers, loading, error } = useSelector((state: RootState) => state.products);
  const { isAuthenticated, user } = useAuth();

  useEffect(() => {
    dispatch(fetchBestsellers());
  }, [dispatch]);

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
      {/* Hero Section */}
      <div className="bg-primary text-white rounded p-5 mb-5 text-center">
        <h1 className="display-4 fw-bold">Welcome to Bookstore</h1>
        <p className="lead">Discover your next great read from our extensive collection</p>
        <div className="mt-4">
          <Button as={Link} to="/products" variant="light" size="lg" className="me-3">
            Browse All Books
          </Button>
          {!isAuthenticated && (
            <Button variant="outline-light" size="lg">
              Sign Up
            </Button>
          )}
        </div>
      </div>

      {/* Features Section */}
      <Row className="mb-5">
        <Col md={4} className="mb-3">
          <Card className="text-center h-100">
            <Card.Body>
              <div className="display-1 mb-3">📚</div>
              <Card.Title>Wide Selection</Card.Title>
              <Card.Text>
                Browse thousands of books across all genres and categories
              </Card.Text>
            </Card.Body>
          </Card>
        </Col>
        <Col md={4} className="mb-3">
          <Card className="text-center h-100">
            <Card.Body>
              <div className="display-1 mb-3">⚡</div>
              <Card.Title>Fast Delivery</Card.Title>
              <Card.Text>
                Get your books delivered quickly with our efficient service
              </Card.Text>
            </Card.Body>
          </Card>
        </Col>
        <Col md={4} className="mb-3">
          <Card className="text-center h-100">
            <Card.Body>
              <div className="display-1 mb-3">💰</div>
              <Card.Title>Best Prices</Card.Title>
              <Card.Text>
                Competitive pricing and regular discounts on popular titles
              </Card.Text>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {/* Bestsellers Section */}
      <div className="mb-5">
        <div className="d-flex justify-content-between align-items-center mb-4">
          <h2>📈 Bestsellers</h2>
          <Button as={Link} to="/products" variant="outline-primary">
            View All
          </Button>
        </div>

        {loading && <LoadingSpinner message="Loading bestsellers..." />}

        {error && (
          <ErrorMessage
            message={error}
            onRetry={() => dispatch(fetchBestsellers())}
          />
        )}

        {!loading && !error && bestsellers.length === 0 && (
          <div className="empty-state">
            <h3>No bestsellers available</h3>
            <p>Check back soon for our top picks!</p>
          </div>
        )}

        {!loading && !error && bestsellers.length > 0 && (
          <Row>
            {bestsellers.slice(0, 4).map((product) => (
              <Col key={product.id} sm={6} md={4} lg={3} className="mb-4">
                <ProductCard product={product} onAddToCart={handleAddToCart} />
              </Col>
            ))}
          </Row>
        )}
      </div>

      {/* CTA Section */}
      <div className="bg-light rounded p-5 text-center">
        <h2 className="mb-3">Ready to start reading?</h2>
        <p className="lead mb-4">
          Join thousands of book lovers and discover your next favorite book today
        </p>
        <Button as={Link} to="/products" variant="primary" size="lg">
          Start Shopping
        </Button>
      </div>
    </Container>
  );
};

export default HomePage;
