import React, { useEffect, useState } from 'react';
import { Container, Row, Col, Button, Badge, Form } from 'react-bootstrap';
import { useParams, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { AppDispatch, RootState } from '../store';
import { fetchProduct, clearCurrentProduct } from '../store/slices/productsSlice';
import { addToCart } from '../store/slices/cartSlice';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';
import { useAuth } from '../hooks/useAuth';
import { toast } from 'react-toastify';

const ProductDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const dispatch = useDispatch<AppDispatch>();
  const { currentProduct, loading, error } = useSelector((state: RootState) => state.products);
  const { isAuthenticated, user } = useAuth();
  const [quantity, setQuantity] = useState(1);

  useEffect(() => {
    if (id) {
      dispatch(fetchProduct(id));
    }
    return () => {
      dispatch(clearCurrentProduct());
    };
  }, [dispatch, id]);

  const handleAddToCart = () => {
    if (!isAuthenticated || !user?.sub || !currentProduct) {
      toast.error('Please login to add items to cart');
      return;
    }

    dispatch(addToCart({
      userId: user.sub,
      productId: currentProduct.id,
      quantity,
    }))
      .unwrap()
      .then(() => {
        toast.success(`${currentProduct.title} added to cart!`);
      })
      .catch(() => {
        toast.error('Failed to add item to cart');
      });
  };

  if (loading) {
    return <LoadingSpinner message="Loading product details..." />;
  }

  if (error) {
    return (
      <Container className="py-4">
        <ErrorMessage message={error} onRetry={() => id && dispatch(fetchProduct(id))} />
      </Container>
    );
  }

  if (!currentProduct) {
    return (
      <Container className="py-4">
        <div className="empty-state">
          <h3>Product not found</h3>
          <Button variant="primary" onClick={() => navigate('/products')}>
            Back to Products
          </Button>
        </div>
      </Container>
    );
  }

  const defaultImage = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="400" height="600"%3E%3Crect width="400" height="600" fill="%23ddd"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" dy=".3em" fill="%23999" font-size="30"%3ENo Image%3C/text%3E%3C/svg%3E';

  return (
    <Container className="py-4">
      <Button variant="link" onClick={() => navigate(-1)} className="mb-3 ps-0">
        ← Back
      </Button>

      <Row>
        <Col md={5}>
          <img
            src={currentProduct.coverImage || defaultImage}
            alt={currentProduct.title}
            className="img-fluid rounded shadow"
            style={{ width: '100%', maxHeight: '600px', objectFit: 'cover' }}
          />
        </Col>

        <Col md={7}>
          <h1 className="mb-3">{currentProduct.title}</h1>
          <h4 className="text-muted mb-3">by {currentProduct.author}</h4>

          <div className="mb-3">
            <Badge bg="secondary" className="me-2">{currentProduct.category}</Badge>
            {currentProduct.rating && (
              <Badge bg="warning" text="dark">
                ⭐ {currentProduct.rating.toFixed(1)}
              </Badge>
            )}
          </div>

          <h2 className="text-primary mb-4">${currentProduct.price.toFixed(2)}</h2>

          {currentProduct.description && (
            <div className="mb-4">
              <h5>Description</h5>
              <p className="text-muted">{currentProduct.description}</p>
            </div>
          )}

          {currentProduct.isbn && (
            <div className="mb-3">
              <strong>ISBN:</strong> {currentProduct.isbn}
            </div>
          )}

          {currentProduct.publishedDate && (
            <div className="mb-3">
              <strong>Published:</strong> {new Date(currentProduct.publishedDate).toLocaleDateString()}
            </div>
          )}

          <div className="mb-4">
            {currentProduct.stock !== undefined && (
              <div className="mb-2">
                {currentProduct.stock > 0 ? (
                  <Badge bg="success">In Stock ({currentProduct.stock} available)</Badge>
                ) : (
                  <Badge bg="danger">Out of Stock</Badge>
                )}
              </div>
            )}
          </div>

          <Row className="align-items-end mb-3">
            <Col xs={4}>
              <Form.Group>
                <Form.Label>Quantity</Form.Label>
                <Form.Control
                  type="number"
                  min="1"
                  max={currentProduct.stock || 99}
                  value={quantity}
                  onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
                />
              </Form.Group>
            </Col>
            <Col xs={8}>
              <Button
                variant="primary"
                size="lg"
                className="w-100"
                onClick={handleAddToCart}
                disabled={currentProduct.stock === 0}
              >
                🛒 Add to Cart
              </Button>
            </Col>
          </Row>

          {!isAuthenticated && (
            <div className="alert alert-info">
              Please login to add items to your cart
            </div>
          )}
        </Col>
      </Row>
    </Container>
  );
};

export default ProductDetailPage;
