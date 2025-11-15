import React, { useEffect } from 'react';
import { Container, Row, Col, Button, Card, ListGroup, Form } from 'react-bootstrap';
import { Link, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { AppDispatch, RootState } from '../store';
import { fetchCart, updateCartItem, removeFromCart, clearCart } from '../store/slices/cartSlice';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';
import { useAuth } from '../hooks/useAuth';
import { toast } from 'react-toastify';

const CartPage: React.FC = () => {
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const { cart, loading, error } = useSelector((state: RootState) => state.cart);
  const { user } = useAuth();

  useEffect(() => {
    if (user?.sub) {
      dispatch(fetchCart(user.sub));
    }
  }, [dispatch, user]);

  const handleUpdateQuantity = (productId: string, quantity: number) => {
    if (!user?.sub) return;

    if (quantity < 1) return;

    dispatch(updateCartItem({ userId: user.sub, productId, quantity }))
      .unwrap()
      .then(() => {
        toast.success('Cart updated');
      })
      .catch(() => {
        toast.error('Failed to update cart');
      });
  };

  const handleRemoveItem = (productId: string) => {
    if (!user?.sub) return;

    dispatch(removeFromCart({ userId: user.sub, productId }))
      .unwrap()
      .then(() => {
        toast.success('Item removed from cart');
      })
      .catch(() => {
        toast.error('Failed to remove item');
      });
  };

  const handleClearCart = () => {
    if (!user?.sub) return;

    if (window.confirm('Are you sure you want to clear your cart?')) {
      dispatch(clearCart(user.sub))
        .unwrap()
        .then(() => {
          toast.success('Cart cleared');
        })
        .catch(() => {
          toast.error('Failed to clear cart');
        });
    }
  };

  const handleCheckout = () => {
    navigate('/checkout');
  };

  if (loading) {
    return <LoadingSpinner message="Loading your cart..." />;
  }

  if (error) {
    return (
      <Container className="py-4">
        <ErrorMessage message={error} onRetry={() => user?.sub && dispatch(fetchCart(user.sub))} />
      </Container>
    );
  }

  const isEmpty = !cart || cart.items.length === 0;

  return (
    <Container className="py-4">
      <h1 className="mb-4">🛒 Shopping Cart</h1>

      {isEmpty ? (
        <div className="empty-state">
          <h3>Your cart is empty</h3>
          <p>Start adding some books to your cart!</p>
          <Button as={Link} to="/products" variant="primary" size="lg">
            Browse Books
          </Button>
        </div>
      ) : (
        <Row>
          <Col lg={8}>
            <Card>
              <Card.Header className="d-flex justify-content-between align-items-center">
                <span>Cart Items ({cart.itemCount})</span>
                <Button variant="outline-danger" size="sm" onClick={handleClearCart}>
                  Clear Cart
                </Button>
              </Card.Header>
              <ListGroup variant="flush">
                {cart.items.map((item) => (
                  <ListGroup.Item key={item.productId}>
                    <Row className="align-items-center">
                      <Col md={2}>
                        <img
                          src={item.product.coverImage || 'https://via.placeholder.com/100x150'}
                          alt={item.product.title}
                          className="img-fluid rounded"
                        />
                      </Col>
                      <Col md={4}>
                        <h6>
                          <Link to={`/products/${item.productId}`} className="text-decoration-none">
                            {item.product.title}
                          </Link>
                        </h6>
                        <small className="text-muted">{item.product.author}</small>
                      </Col>
                      <Col md={2} className="text-center">
                        <strong>${item.price.toFixed(2)}</strong>
                      </Col>
                      <Col md={2}>
                        <Form.Group className="d-flex align-items-center">
                          <Button
                            variant="outline-secondary"
                            size="sm"
                            onClick={() => handleUpdateQuantity(item.productId, item.quantity - 1)}
                            disabled={item.quantity <= 1}
                          >
                            -
                          </Button>
                          <Form.Control
                            type="text"
                            value={item.quantity}
                            readOnly
                            className="text-center mx-2"
                            style={{ width: '50px' }}
                          />
                          <Button
                            variant="outline-secondary"
                            size="sm"
                            onClick={() => handleUpdateQuantity(item.productId, item.quantity + 1)}
                          >
                            +
                          </Button>
                        </Form.Group>
                      </Col>
                      <Col md={2} className="text-end">
                        <div className="mb-2">
                          <strong>${(item.price * item.quantity).toFixed(2)}</strong>
                        </div>
                        <Button
                          variant="link"
                          size="sm"
                          className="text-danger p-0"
                          onClick={() => handleRemoveItem(item.productId)}
                        >
                          Remove
                        </Button>
                      </Col>
                    </Row>
                  </ListGroup.Item>
                ))}
              </ListGroup>
            </Card>
          </Col>

          <Col lg={4}>
            <Card>
              <Card.Header>
                <h5 className="mb-0">Order Summary</h5>
              </Card.Header>
              <Card.Body>
                <div className="d-flex justify-content-between mb-2">
                  <span>Subtotal:</span>
                  <strong>${cart.total.toFixed(2)}</strong>
                </div>
                <div className="d-flex justify-content-between mb-2">
                  <span>Shipping:</span>
                  <strong>FREE</strong>
                </div>
                <hr />
                <div className="d-flex justify-content-between mb-3">
                  <strong>Total:</strong>
                  <strong className="text-primary">${cart.total.toFixed(2)}</strong>
                </div>
                <Button variant="primary" size="lg" className="w-100" onClick={handleCheckout}>
                  Proceed to Checkout
                </Button>
                <Button as={Link} to="/products" variant="outline-secondary" className="w-100 mt-2">
                  Continue Shopping
                </Button>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      )}
    </Container>
  );
};

export default CartPage;
